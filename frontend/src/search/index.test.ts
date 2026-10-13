import { Plus } from 'lucide-react'
import { expect, test } from 'vitest'
import type { Task } from '@/api/tasks'
import type { AppNode } from '@/canvas/types'
import { buildIndex, search } from './index'
import { words } from './match'
import { viewFor } from './view'

const task = (key: string, summary: string, extra: Partial<Task> = {}): Task => ({
  source: 'demo',
  key,
  state: 'ok',
  summary,
  status_name: 'In Progress',
  status_category: 'indeterminate',
  type_name: 'Bug',
  assignee_name: 'Anna Lee',
  priority_name: 'High',
  updated: null,
  url: `https://jira.example.com/browse/${key}`,
  fetched_at: '2026-10-07T09:00:00Z',
  ...extra,
})

const at = { x: 0, y: 0 }
const nodes: AppNode[] = [
  { id: 'f', type: 'frame', position: at, data: { title: 'Sprint 12' } },
  {
    id: 's',
    type: 'sticky',
    position: at,
    parentId: 'f',
    data: { text: 'Ping QA after deploy', color: 'yellow' },
  },
  { id: 'e', type: 'sticky', position: at, data: { text: '  ', color: 'yellow' } },
  { id: 'c', type: 'task_card', position: at, parentId: 'f', data: { key: 'DEMO-1' } },
  { id: 'n', type: 'task_card', position: at, data: { key: 'DEMO-9' } },
  {
    id: 't',
    type: 'timer',
    position: at,
    parentId: 'c',
    data: { note: 'Ask about deploy', dueAt: null },
  },
  {
    id: 'g',
    type: 'module',
    position: at,
    data: {
      kind: 'gantt',
      title: 'Q4 plan',
      content: {
        start: '2026-10-01',
        end: '2026-12-31',
        scale: 'week',
        rows: [
          { id: 'r1', key: 'DEMO-1', title: '', start: '2026-10-01', end: '2026-10-09' },
          { id: 'r2', title: 'Write docs', start: '2026-10-01', end: '2026-10-09' },
        ],
        milestones: [{ id: 'm1', date: '2026-11-01', title: 'Beta release' }],
        links: [],
      },
    },
  },
  { id: 'a', type: 'anchor', position: at, data: {} },
]
const tasks = {
  'DEMO-1': task('DEMO-1', 'Fix login on Safari'),
  'DEMO-9': task('DEMO-9', '', { state: 'not_found' }),
}

test('indexes every text with where it lives', () => {
  const index = buildIndex(nodes, tasks)
  expect(
    index.map((e) => [e.id, e.kind, e.label ?? '', e.text, e.context ?? '', e.target]),
  ).toEqual([
    ['f', 'frame', '', 'Sprint 12', '', 'f'],
    ['s', 'sticky', '', 'Ping QA after deploy', 'in Sprint 12', 's'],
    ['c', 'card', 'DEMO-1', 'Fix login on Safari', 'In Progress · Anna Lee · in Sprint 12', 'c'],
    ['n', 'card', 'DEMO-9', 'Not found', '', 'n'],
    ['t', 'timer', '', 'Ask about deploy', 'on DEMO-1', 't'],
    ['g', 'module', '', 'Q4 plan', '', 'g'],
    ['g:0', 'row', 'DEMO-1', 'Fix login on Safari', 'in Q4 plan', 'g'],
    ['g:1', 'row', '', 'Write docs', 'in Q4 plan', 'g'],
    ['g:2', 'milestone', '', 'Beta release', 'in Q4 plan', 'g'],
  ])
})

test('cards are found by status, assignee, type and priority', () => {
  const index = buildIndex(nodes, tasks)
  const ids = (q: string) => search(index, words(q)).entries.map((e) => e.id)
  expect(ids('anna progress')).toEqual(['c', 'g:0'])
  expect(ids('bug high')).toEqual(['c', 'g:0'])
  expect(ids('demo-1')).toEqual(['c', 'g:0'])
  expect(ids('deploy')).toEqual(['s', 't'])
})

test('filters narrow to tasks; values of one field are alternatives, fields add up', () => {
  const index = buildIndex(
    [
      ...nodes,
      { id: 'd', type: 'task_card', position: at, data: { key: 'DEMO-2' } },
      { id: 'x', type: 'task_card', position: at, data: { key: 'DEMO-3' } },
    ],
    {
      ...tasks,
      'DEMO-2': task('DEMO-2', 'Ship docs', { assignee_name: 'Oleg Smirnov', status_name: 'Done' }),
      'DEMO-3': task('DEMO-3', 'Fix login', { assignee_name: 'Oleg Smirnov' }),
    },
  )
  const ids = (text: string, chips = []) =>
    viewFor(index, text, [], chips).groups.flatMap((g) => g.entries.map((e) => e.id))
  expect(ids('@anna ')).toEqual(['c', 'g:0'])
  expect(ids('@oleg status:prog ')).toEqual(['x'])
  expect(ids('@anna @oleg login ')).toEqual(['c', 'g:0', 'x'])
  expect(ids('login', [{ field: 'assignee', value: 'Oleg Smirnov' }] as never)).toEqual(['x'])
  expect(ids('#')).toEqual(['f', 'g'])
  expect(ids('#q4')).toEqual(['g'])
})

test('suggests values while a filter is typed, one per task', () => {
  const view = viewFor(buildIndex(nodes, tasks), '@an', [])
  expect(view.groups).toEqual([])
  expect(view.suggestions).toEqual({
    field: 'assignee',
    values: [{ value: 'Anna Lee', count: 1 }],
  })
})

test('suggestions count only tasks that pass the chips', () => {
  const index = buildIndex(
    nodes.concat({ id: 'd', type: 'task_card', position: at, data: { key: 'DEMO-2' } }),
    {
      ...tasks,
      'DEMO-2': task('DEMO-2', 'Ship docs', { assignee_name: 'Oleg Smirnov', type_name: 'Task' }),
    },
  )
  const types = (chips: { field: 'assignee'; value: string }[]) =>
    viewFor(index, 'type:', [], chips).suggestions?.values.map((v) => v.value)
  expect(types([])).toEqual(['Bug', 'Task'])
  expect(types([{ field: 'assignee', value: 'Oleg Smirnov' }])).toEqual(['Task'])
})

test('commands and boards join a plain query; > lists only them', () => {
  const run = () => {}
  const commands = [
    { id: 'a', title: 'Add sticky note', group: 'Commands' as const, Icon: Plus, run },
    { id: 'b', title: 'Go to board Release', group: 'Boards' as const, Icon: Plus, run },
    { id: 'c', title: 'Settings', group: 'Commands' as const, Icon: Plus, run },
  ]
  const index = buildIndex(nodes, tasks)
  const view = (text: string) => viewFor(index, text, [], [], commands)
  expect(view('release').commands.map((c) => c.id)).toEqual(['b'])
  expect(view('beta').groups[0].entries.map((e) => e.id)).toEqual(['g:2'])
  expect(view('@anna release').commands).toEqual([])
  expect(view('>').commands.map((c) => c.id)).toEqual(['a', 'c', 'b'])
  expect(view('> sett').commands.map((c) => c.id)).toEqual(['c'])
  expect(view('> sett').groups).toEqual([])
  expect(view('ыуеештпы').fallback).toBe('settings')
})

test('an empty query lists recent jumps that still exist, then frames', () => {
  const view = viewFor(buildIndex(nodes, tasks), '', ['t', 'gone', 's'])
  expect(view.groups.map((g) => [g.title, g.entries.map((e) => e.id)])).toEqual([
    ['Recent', ['t', 's']],
    ['Frames', ['f']],
  ])
})

test('falls back to the other keyboard layout and says so', () => {
  const view = viewFor(buildIndex(nodes, tasks), 'вузд', [])
  expect(view.fallback).toBe('depl')
  expect(view.groups[0].entries.map((e) => e.id)).toEqual(['s', 't'])
})

test('shows at most 50 rows and counts the rest', () => {
  const many: AppNode[] = Array.from({ length: 60 }, (_, i) => ({
    id: `s${i}`,
    type: 'sticky',
    position: at,
    data: { text: `note ${i}`, color: 'yellow' },
  }))
  const view = viewFor(buildIndex(many, {}), 'note', [])
  expect(view.groups[0].entries).toHaveLength(50)
  expect(view.more).toBe(10)
})

test('a keystroke on a board of 5000 elements stays within a frame', () => {
  const big: AppNode[] = Array.from({ length: 5000 }, (_, i) => ({
    id: `s${i}`,
    type: 'sticky',
    position: at,
    data: { text: `Sticky number ${i} about release ${i % 37} and deploy`, color: 'yellow' },
  }))
  const index = buildIndex(big, {})
  const queries = ['r', 're', 'rel', 'rele', 'release 3']
  // A busy runner only ever adds time, so the fastest of several rounds is the search itself.
  let best = Infinity
  for (let round = 0; round < 7; round++) {
    const start = performance.now()
    for (const q of queries) viewFor(index, q, [])
    best = Math.min(best, (performance.now() - start) / queries.length)
  }
  expect(best).toBeLessThan(16)
})
