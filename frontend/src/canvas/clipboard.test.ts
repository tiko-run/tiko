import { expect, test } from 'vitest'
import {
  cloneSnippet,
  copySelection,
  dragCopy,
  isStandIn,
  snippetOrigin,
  withStandIns,
} from '@/canvas/clipboard'
import type { Task } from '@/api/tasks'
import type { AppEdge, AppNode } from '@/canvas/types'

const frame: AppNode = {
  id: 'f',
  type: 'frame',
  position: { x: 100, y: 100 },
  width: 400,
  height: 300,
  data: { title: 'Q4' },
}

function card(id: string, x: number, y: number, extra: Partial<AppNode> = {}): AppNode {
  return { id, type: 'task_card', position: { x, y }, data: { key: 'DEMO-1' }, ...extra } as AppNode
}

const edges: AppEdge[] = [
  { id: 'e1', source: 'a', target: 'b' },
  { id: 'e2', source: 'a', target: 'c' },
]

test('nothing selected copies nothing', () => {
  expect(copySelection([frame, card('a', 0, 0)], edges, {})).toBeNull()
})

test('a selected frame brings its contents; a lone child is copied in absolute position', () => {
  const nodes = [
    { ...frame, selected: true },
    card('a', 10, 20, { parentId: 'f' }),
    card('b', 50, 60, { parentId: 'f' }),
    card('c', 900, 900),
  ]
  const snippet = copySelection(nodes, edges, {})!
  expect(snippet.nodes.map((n) => n.id)).toEqual(['f', 'a', 'b'])
  expect(snippet.nodes[1].position).toEqual({ x: 10, y: 20 })
  expect(snippet.edges.map((e) => e.id)).toEqual(['e1'])

  const lone = copySelection([frame, card('a', 10, 20, { parentId: 'f', selected: true })], [], {})!
  expect(lone.nodes[0]).toMatchObject({ position: { x: 110, y: 120 } })
  expect(lone.nodes[0].parentId).toBeUndefined()
})

test('a clone gets new ids, keeps links between its parts and moves only top-level nodes', () => {
  const snippet = copySelection(
    [
      { ...frame, selected: true },
      card('a', 10, 20, { parentId: 'f' }),
      card('b', 600, 0, { selected: true }),
    ],
    [{ id: 'e', source: 'a', target: 'b' }],
    {},
  )!
  expect(snippetOrigin(snippet)).toEqual({ x: 100, y: 0 })

  const copy = cloneSnippet(snippet, { x: 24, y: 24 })
  const [f, a, b] = copy.nodes
  expect(new Set([f.id, a.id, b.id, 'f', 'a', 'b']).size).toBe(6)
  expect(f.position).toEqual({ x: 124, y: 124 })
  expect(a).toMatchObject({ parentId: f.id, position: { x: 10, y: 20 }, selected: true })
  expect(copy.edges[0]).toMatchObject({ source: a.id, target: b.id })
  expect(copy.edges[0].id).not.toBe('e')
})

test('a copied module carries the live tasks of its rows', () => {
  const content = {
    start: '2026-10-01',
    end: '2026-12-31',
    scale: 'week',
    rows: [{ id: 'r', key: 'DEMO-2', title: '', start: '2026-10-05', end: '2026-10-09' }],
  }
  const gantt = {
    id: 'g',
    type: 'module',
    position: { x: 0, y: 0 },
    data: { kind: 'gantt', content },
    selected: true,
  } as AppNode
  const task = { key: 'DEMO-2' } as Task
  const snippet = copySelection([gantt], [], { 'DEMO-2': task, 'DEMO-9': task })!
  expect(Object.keys(snippet.tasks)).toEqual(['DEMO-2'])
  const copy = cloneSnippet(snippet, { x: 10, y: 0 })
  expect(copy.nodes[0].data).toEqual(gantt.data)
  expect(copy.nodes[0].data).not.toBe(gantt.data)
})

test('a drag that copies puts the originals back and copies them where they were dropped', () => {
  const nodes = [
    card('a', 300, 300, { dragging: true }),
    card('b', 350, 300, { dragging: true }),
    card('c', 0, 0),
  ]
  const from = new Map([
    ['a', { x: 0, y: 100 }],
    ['b', { x: 50, y: 100 }],
  ])
  const copied = dragCopy(nodes, edges, {}, from)!
  expect(copied.nodes.map((n) => [n.id, n.position, n.dragging])).toEqual([
    ['a', { x: 0, y: 100 }, false],
    ['b', { x: 50, y: 100 }, false],
    ['c', { x: 0, y: 0 }, undefined],
  ])
  expect(copied.snippet.nodes.map((n) => [n.id, n.position])).toEqual([
    ['a', { x: 300, y: 300 }],
    ['b', { x: 350, y: 300 }],
  ])
  // Only the arrow between two copied elements comes along.
  expect(copied.snippet.edges.map((e) => e.id)).toEqual(['e1'])
})

test('a drag that copies but did not move copies nothing', () => {
  const from = new Map([['a', { x: 0, y: 0 }]])
  expect(dragCopy([card('a', 0, 0, { dragging: true })], edges, {}, from)).toBeNull()
})

test('while a drag copies, a stand-in stays where it began, before its node and after its frame', () => {
  const nodes = [frame, card('a', 10, 20, { parentId: 'f', dragging: true }), card('c', 0, 0)]
  const shown = withStandIns(nodes, new Map([['a', { x: 5, y: 5 }]]))
  expect(shown.map((n) => [n.id, n.parentId, n.position, n.className])).toEqual([
    ['f', undefined, { x: 100, y: 100 }, undefined],
    ['stay:a', 'f', { x: 5, y: 5 }, undefined],
    ['a', 'f', { x: 10, y: 20 }, 'drag-ghost'],
    ['c', undefined, { x: 0, y: 0 }, undefined],
  ])
  expect(shown.filter((n) => isStandIn(n.id)).every((n) => n.draggable === false)).toBe(true)
})
