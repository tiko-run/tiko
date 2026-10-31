import { expect, test } from 'vitest'
import type { StageType } from '@/api/planning'
import type { Row } from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'
import {
  addStage,
  BARE,
  fitLeaves,
  clampStage,
  dragStage,
  fitStages,
  gapAt,
  nextType,
  removeStage,
  shownStages,
  updateStage,
} from '@/modules/gantt/stages'
import { parseDay } from '@/modules/gantt/timeline'
import { shiftBranch } from '@/modules/gantt/tree'

const d = parseDay
const types: StageType[] = [
  { id: 't1', name: 'Discovery', hue: 75, archived: false },
  { id: 't2', name: 'Design', hue: 150, archived: false },
  { id: 't3', name: 'Build', hue: 250, archived: false },
  { id: 't5', name: 'On hold', hue: 25, archived: false },
]
const staged: Row = {
  id: 'r',
  title: 'Payment API',
  start: '2026-10-05',
  end: '2026-10-16',
  stages: [
    { id: 's1', type: 't1', start: '2026-10-05', end: '2026-10-07', people: [] },
    { id: 's2', type: 't2', start: '2026-10-12', end: '2026-10-16', people: [] },
  ],
}
const bare: Row = { id: 'b', title: 'Kickoff', start: '2026-10-05', end: '2026-10-09' }

test('a row without stages shows its bar as one stage without a type', () => {
  expect(shownStages(bare)).toEqual([
    { id: BARE, type: '', start: '2026-10-05', end: '2026-10-09', people: [] },
  ])
})

test('the free gap around a day stops at the stages on both sides', () => {
  expect(gapAt(staged, d('2026-10-09'))).toEqual({ start: d('2026-10-08'), end: d('2026-10-11') })
  expect(gapAt(staged, d('2026-10-06'))).toBeNull()
})

test('a stage stops at its neighbours when moved or resized', () => {
  const left = { start: d('2026-10-01'), end: d('2026-10-05') }
  expect(clampStage(staged, 's2', left, 'move')).toEqual({
    start: d('2026-10-08'),
    end: d('2026-10-12'),
  })
  expect(
    clampStage(staged, 's2', { start: d('2026-10-01'), end: d('2026-10-16') }, 'start'),
  ).toEqual({
    start: d('2026-10-08'),
    end: d('2026-10-16'),
  })
  expect(clampStage(staged, 's1', { start: d('2026-10-05'), end: d('2026-10-20') }, 'end')).toEqual(
    {
      start: d('2026-10-05'),
      end: d('2026-10-11'),
    },
  )
})

test('a new stage takes the type after the previous one and skips a pause', () => {
  expect(nextType(types, bare, d('2026-10-01'))).toBe('t1')
  expect(nextType(types, staged, d('2026-10-19'))).toBe('t3')
  const afterBuild = updateStage(staged, 's2', { type: 't3' })
  expect(nextType(types, afterBuild, d('2026-10-19'))).toBe('t3')
  const archived = types.map((t) => (t.id === 't1' ? { ...t, archived: true } : t))
  expect(nextType(archived, bare, d('2026-10-01'))).toBe('t2')
})

test('adding a stage keeps the bare bar as a stage and the row spans both', () => {
  const added = addStage(bare, { start: d('2026-10-12'), end: d('2026-10-16') }, 't2')!
  expect(added.row.start).toBe('2026-10-05')
  expect(added.row.end).toBe('2026-10-16')
  expect(added.row.stages!.map((s) => s.type)).toEqual(['', 't2'])
  expect(added.row.stages!.every((s) => s.id !== BARE)).toBe(true)
})

test('picking a type for the bare bar makes it the first stage with the same dates', () => {
  const typed = updateStage(bare, BARE, { type: 't3' })
  expect(typed.stages).toHaveLength(1)
  expect(typed.stages![0]).toMatchObject({ type: 't3', start: '2026-10-05', end: '2026-10-09' })
})

test('removing the last stage leaves a plain bar with the same dates', () => {
  const one = removeStage(staged, 's1')
  expect(one.start).toBe('2026-10-12')
  const none = removeStage(one, 's2')
  expect(none.stages).toBeUndefined()
  expect([none.start, none.end]).toEqual(['2026-10-12', '2026-10-16'])
})

test('with Planning off the bar moves every stage and stretches the outer ones', () => {
  const moved = fitStages(staged, { start: d('2026-10-07'), end: d('2026-10-18') })
  expect(moved.stages!.map((s) => [s.start, s.end])).toEqual([
    ['2026-10-07', '2026-10-09'],
    ['2026-10-14', '2026-10-18'],
  ])
  const stretched = fitStages(staged, { start: d('2026-10-01'), end: d('2026-10-20') })
  expect(stretched.stages![0].start).toBe('2026-10-01')
  expect(stretched.stages![1].end).toBe('2026-10-20')
  const squeezed = fitStages(staged, { start: d('2026-10-10'), end: d('2026-10-16') })
  expect(squeezed.stages![0].start).toBe('2026-10-07')
  expect(squeezed.start).toBe('2026-10-07')
})

test('moving a branch moves the stages of its rows', () => {
  const content: GanttContent = {
    start: '2026-10-01',
    end: '2026-12-31',
    scale: 'week',
    labelWidth: 160,
    rows: [
      { id: 'p', title: 'Parent', start: '2026-10-05', end: '2026-10-16' },
      { ...staged, parent: 'p' },
    ],
    milestones: [],
    links: [],
  }
  const shifted = shiftBranch(content, 'p', 7).rows[1]
  expect(shifted.start).toBe('2026-10-12')
  expect(shifted.stages![0].start).toBe('2026-10-12')
  expect(shifted.stages![1].end).toBe('2026-10-23')
})

test('after a pause a new stage follows the stage before the pause', () => {
  const paused = withPause()
  expect(nextType(types, paused, d('2026-10-26'))).toBe('t3')
})

function withPause(): Row {
  return {
    ...staged,
    end: '2026-10-23',
    stages: [
      ...staged.stages!,
      { id: 's3', type: 't5', start: '2026-10-19', end: '2026-10-23', people: [] },
    ],
  }
}

test('a row that stops being a parent takes its stages dates again', () => {
  const content: GanttContent = {
    start: '2026-10-01',
    end: '2026-12-31',
    scale: 'week',
    labelWidth: 160,
    rows: [{ ...staged, start: '2026-10-01', end: '2026-10-30' }],
    milestones: [],
    links: [],
  }
  const fitted = fitLeaves(content).rows[0]
  expect([fitted.start, fitted.end]).toEqual(['2026-10-05', '2026-10-16'])
  const parent = { ...content, rows: [...content.rows, { ...bare, parent: 'r' }] }
  expect(fitLeaves(parent)).toBe(parent)
})

const spans = (row: Row) => row.stages!.map((s) => [s.start, s.end])

test('a stage moved or stretched right with Alt pushes the later stages by the same days', () => {
  const three = withPause()
  const moved = dragStage(
    three,
    's1',
    { start: d('2026-10-10'), end: d('2026-10-12') },
    'move',
    true,
  )
  expect(spans(moved)).toEqual([
    ['2026-10-10', '2026-10-12'],
    ['2026-10-17', '2026-10-21'],
    ['2026-10-24', '2026-10-28'],
  ])
  expect(moved.end).toBe('2026-10-28')
  const stretched = dragStage(
    three,
    's1',
    { start: d('2026-10-05'), end: d('2026-10-09') },
    'end',
    true,
  )
  expect(spans(stretched)).toEqual([
    ['2026-10-05', '2026-10-09'],
    ['2026-10-14', '2026-10-18'],
    ['2026-10-21', '2026-10-25'],
  ])
})

test('a stage moved left, by its start or without Alt stops at its neighbours alone', () => {
  const three = withPause()
  const left = dragStage(
    three,
    's2',
    { start: d('2026-10-01'), end: d('2026-10-05') },
    'move',
    true,
  )
  expect(spans(left)).toEqual([
    ['2026-10-05', '2026-10-07'],
    ['2026-10-08', '2026-10-12'],
    ['2026-10-19', '2026-10-23'],
  ])
  const alone = dragStage(
    three,
    's1',
    { start: d('2026-10-15'), end: d('2026-10-17') },
    'move',
    false,
  )
  expect(spans(alone)[0]).toEqual(['2026-10-09', '2026-10-11'])
  expect(spans(alone).slice(1)).toEqual(spans(three).slice(1))
  const start = dragStage(
    three,
    's2',
    { start: d('2026-10-14'), end: d('2026-10-16') },
    'start',
    true,
  )
  expect(spans(start).slice(1)).toEqual([
    ['2026-10-14', '2026-10-16'],
    ['2026-10-19', '2026-10-23'],
  ])
})

test('the last stage pushed right with Alt moves only itself', () => {
  const three = withPause()
  const last = dragStage(
    three,
    's3',
    { start: d('2026-10-21'), end: d('2026-10-25') },
    'move',
    true,
  )
  expect(spans(last)[2]).toEqual(['2026-10-21', '2026-10-25'])
  expect(spans(last).slice(0, 2)).toEqual(spans(three).slice(0, 2))
})

test('with weekends hidden a moved stage keeps the dates it was dragged to', () => {
  // One shown day from Mon–Fri lands on Tue–Mon: the start moves one day, the end three.
  const week: Row = {
    id: 'w',
    title: 'Week',
    start: '2026-10-05',
    end: '2026-10-16',
    stages: [
      { id: 'a', type: 't1', start: '2026-10-05', end: '2026-10-09', people: [] },
      { id: 'b', type: 't2', start: '2026-10-14', end: '2026-10-16', people: [] },
    ],
  }
  const moved = dragStage(week, 'a', { start: d('2026-10-06'), end: d('2026-10-12') }, 'move', true)
  expect(spans(moved)).toEqual([
    ['2026-10-06', '2026-10-12'],
    ['2026-10-17', '2026-10-19'],
  ])
})
