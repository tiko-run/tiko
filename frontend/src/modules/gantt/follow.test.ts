import { expect, test } from 'vitest'
import type { Task } from '@/api/tasks'
import {
  detachEdited,
  drift,
  followTracker,
  trackerDates,
  trackerSpan,
} from '@/modules/gantt/follow'
import { makeRow, type Row } from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'
import { parseDay } from '@/modules/gantt/timeline'

const task = (dates: Partial<Task>): Task => ({
  source: 'demo',
  key: 'DEMO-1',
  state: 'ok',
  summary: 'Rotate the staging certificates',
  status_name: 'To Do',
  status_category: 'new',
  type_name: 'Task',
  assignee_name: null,
  priority_name: null,
  updated: null,
  url: '',
  fetched_at: '',
  ...dates,
})

const day = (iso: string) => parseDay(iso)

const gantt = (rows: Row[]): GanttContent => ({
  start: '2026-10-01',
  end: '2026-12-31',
  scale: 'week',
  labelWidth: 160,
  rows,
  milestones: [],
  links: [],
})

const row: Row = {
  id: 'a',
  key: 'DEMO-1',
  title: '',
  start: '2026-10-05',
  end: '2026-10-09',
  follow: true,
}

test('a missing date is a week from the other, never open', () => {
  expect(trackerSpan(task({ start: '2026-11-02', due: '2026-11-20' }))).toEqual({
    span: { start: day('2026-11-02'), end: day('2026-11-20') },
  })
  expect(trackerSpan(task({ due: '2026-11-20' }))).toEqual({
    span: { start: day('2026-11-14'), end: day('2026-11-20') },
    guess: 'start',
  })
  expect(trackerSpan(task({ start: '2026-11-02' }))).toEqual({
    span: { start: day('2026-11-02'), end: day('2026-11-08') },
    guess: 'end',
  })
  expect(trackerSpan(task({}))).toBeNull()
  expect(trackerSpan(task({ due: '2026-11-20', state: 'no_token' }))).toBeNull()
})

test('following rows take the tracker dates; others and parents keep theirs', () => {
  const content = gantt([
    row,
    { ...row, id: 'b', follow: undefined },
    { ...row, id: 'p', title: 'Parent' },
    { ...row, id: 'c', key: 'DEMO-2', parent: 'p' },
  ])
  const dated = task({ start: '2026-11-02', due: '2026-11-20' })
  const taskOf = (r: Row) => (r.key === 'DEMO-1' ? dated : undefined)
  const next = followTracker(content, taskOf)
  expect(next.rows.map((r) => [r.id, r.start, r.end])).toEqual([
    ['a', '2026-11-02', '2026-11-20'],
    ['b', '2026-10-05', '2026-10-09'],
    ['p', '2026-10-05', '2026-10-09'],
    ['c', '2026-10-05', '2026-10-09'],
  ])
  expect(followTracker(next, taskOf)).toBe(next)
})

test('stages that cannot reach the tracker dates settle instead of moving forever', () => {
  const staged: Row = {
    ...row,
    stages: [
      { id: 's1', type: 'dev', start: '2026-10-05', end: '2026-10-20', people: [] },
      { id: 's2', type: 'qa', start: '2026-10-21', end: '2026-10-25', people: [] },
    ],
    start: '2026-10-05',
    end: '2026-10-25',
  }
  // Shorter than the first stage: the stages keep their own minimum.
  const short = task({ start: '2026-10-05', due: '2026-10-10' })
  const once = followTracker(gantt([staged]), () => short)
  expect(followTracker(once, () => short)).toBe(once)
  expect([once.rows[0].start, once.rows[0].end]).toEqual([
    once.rows[0].stages![0].start,
    once.rows[0].stages![1].end,
  ])
})

test('a bar a person moved stops following; one whose task has no dates keeps following', () => {
  const before = gantt([row, { ...row, id: 'b', key: 'DEMO-2' }])
  const after = gantt([
    { ...row, start: '2026-10-12', end: '2026-10-16' },
    { ...row, id: 'b', key: 'DEMO-2', start: '2026-10-12', end: '2026-10-16' },
  ])
  const { content, detached } = detachEdited(before, after, (r) =>
    r.key === 'DEMO-1' ? task({ due: '2026-10-09' }) : task({}),
  )
  expect(detached).toEqual(['a'])
  expect(content.rows.map((r) => r.follow)).toEqual([undefined, true])
  expect('follow' in content.rows[0]).toBe(false)
})

test('the difference mark compares only the dates the tracker has', () => {
  const shown = { start: day('2026-11-01'), end: day('2026-11-20') }
  expect(drift(task({ due: '2026-11-20' }), shown)).toBeNull()
  expect(drift(task({ due: '2026-11-21' }), shown)?.span.end).toBe(day('2026-11-21'))
  expect(drift(task({ start: '2026-11-02', due: '2026-11-20' }), shown)).not.toBeNull()
  expect(trackerDates(trackerSpan(task({ due: '2026-11-20' }))!)).toBe('Due Fri Nov 20')
  expect(trackerDates(trackerSpan(task({ start: '2026-11-02' }))!)).toBe('Starts Mon Nov 2')
})

test('a row planned from a task follows the tracker, a plain row does not', () => {
  expect(makeRow(gantt([]), { key: 'DEMO-1', source: 'demo' }).follow).toBe(true)
  expect('follow' in makeRow(gantt([]), { title: 'Design review' })).toBe(false)
})
