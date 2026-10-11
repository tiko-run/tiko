import { expect, test } from 'vitest'
import { cloneSnippet, copySelection, snippetOrigin } from '@/canvas/clipboard'
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
