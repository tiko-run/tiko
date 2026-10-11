import { expect, test } from 'vitest'
import fixtures from '@/live/projection.fixtures.json'
import { canon, jsonNode, toJson, type StoredEdge, type StoredNode } from '@/live/doc'

// The backend runs the same cases against its own projection (tests/test_live_doc.py).
test.each(fixtures)('projection: $name', ({ nodes, edges, json }) => {
  expect(
    toJson(
      nodes as unknown as Record<string, StoredNode>,
      edges as unknown as Record<string, StoredEdge>,
    ),
  ).toEqual(json)
})

test('canon ignores key order and undefined values', () => {
  expect(canon({ b: 1, a: { d: undefined, c: [1, { z: 1, y: 2 }] } })).toBe(
    canon({ a: { c: [1, { y: 2, z: 1 }] }, b: 1 }),
  )
  expect(canon({ a: null })).not.toBe(canon({}))
})

test('a card under its old type name is shown as a task card', () => {
  const stored = {
    type: 'jira_card',
    place: { x: 0, y: 0 },
    size: {},
    order: 0,
    data: { key: 'DEMO-1' },
  }
  expect(jsonNode('a', stored).type).toBe('task_card')
})
