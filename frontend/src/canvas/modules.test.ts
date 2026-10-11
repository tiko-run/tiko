import { expect, test } from 'vitest'
import { absorbCards, MODULE_HEADER } from '@/canvas/modules'
import type { AppNode } from '@/canvas/types'

const content = {
  start: '2026-10-01',
  end: '2026-10-31',
  scale: 'week',
  rows: [],
  milestones: [],
  links: [],
}

const gantt: AppNode = {
  id: 'g',
  type: 'module',
  position: { x: 1000, y: 0 },
  width: 960,
  height: 320,
  data: { kind: 'gantt', content },
}

function card(id: string, key: string, x: number, y: number): AppNode {
  return {
    id,
    type: 'task_card',
    position: { x, y },
    measured: { width: 100, height: 20 },
    data: { key, collapsed: false },
  }
}

test('a card dropped on a gantt body becomes a row and leaves the board', () => {
  const nodes = [gantt, card('a', 'DEMO-1', 1400, 150), card('b', 'DEMO-2', 0, 0)]
  const result = absorbCards(nodes, ['a', 'b'])!
  expect([...result.absorbed]).toEqual(['a'])
  expect(result.nodes.map((n) => n.id)).toEqual(['g', 'b'])
  const rows = (result.nodes[0].data as { content: typeof content }).content.rows
  expect(rows).toMatchObject([{ key: 'DEMO-1' }])
})

test('a card on the module header or outside stays on the board', () => {
  const onHeader = card('a', 'DEMO-1', 1400, MODULE_HEADER / 2 - 10)
  expect(absorbCards([gantt, onHeader], ['a'])).toBeNull()
  expect(absorbCards([gantt, card('b', 'DEMO-2', 0, 0)], ['b'])).toBeNull()
})

test('several cards dropped together all land in the same gantt', () => {
  const nodes = [gantt, card('a', 'DEMO-1', 1400, 150), card('b', 'DEMO-2', 1400, 200)]
  const result = absorbCards(nodes, ['a', 'b'])!
  const rows = (result.nodes[0].data as { content: typeof content }).content.rows
  expect(rows.map((r: { key?: string }) => r.key).sort()).toEqual(['DEMO-1', 'DEMO-2'])
})

test('a timer on an absorbed card comes free at the same place', () => {
  const timer: AppNode = {
    id: 't',
    type: 'timer',
    parentId: 'a',
    position: { x: -46, y: 0 },
    width: 40,
    height: 40,
    data: { note: '' },
  }
  const result = absorbCards([gantt, card('a', 'DEMO-1', 1400, 150), timer], ['a'])!
  expect(result.nodes.map((n) => n.id)).toEqual(['g', 't'])
  expect(result.nodes[1].parentId).toBeUndefined()
  expect(result.nodes[1].position).toEqual({ x: 1354, y: 150 })
})
