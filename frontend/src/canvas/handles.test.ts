import { expect, test } from 'vitest'
import { withHandles } from '@/canvas/handles'
import type { AppNode } from '@/canvas/types'

const sticky = {
  id: 's',
  type: 'sticky',
  position: { x: 0, y: 0 },
  width: 200,
  height: 100,
  data: { text: '', color: 'yellow' },
} as AppNode

const centers = (node: AppNode) =>
  Object.fromEntries(
    (node.handles ?? []).map((h) => [h.id, [h.x + (h.width ?? 0) / 2, h.y + (h.height ?? 0) / 2]]),
  )

test('dots sit on the middle of each side', () => {
  expect(centers(withHandles(sticky))).toEqual({
    t: [100, 0],
    r: [200, 50],
    b: [100, 100],
    l: [0, 50],
  })
})

test('a triangle keeps its side dots on its outline', () => {
  const triangle = {
    ...sticky,
    type: 'shape',
    data: { shape: 'triangle', text: '', color: 'none' },
  } as AppNode
  const dots = centers(withHandles(triangle))
  expect(dots.l).toEqual([50, 50])
  expect(dots.r).toEqual([150, 50])
})

test('a measured size wins over the stored one', () => {
  const card = {
    id: 'c',
    type: 'task_card',
    position: { x: 0, y: 0 },
    measured: { width: 120, height: 24 },
    data: { key: 'DEMO-1' },
  } as AppNode
  expect(centers(withHandles(card)).r).toEqual([120, 12])
})

test('the same node gives the same object, so the board does not redraw it', () => {
  expect(withHandles(sticky)).toBe(withHandles(sticky))
})

test('a node without a size, an anchor and a timer are left as they are', () => {
  const unsized = { ...sticky, width: undefined, height: undefined } as AppNode
  const anchor = { id: 'a', type: 'anchor', position: { x: 0, y: 0 }, data: {} } as AppNode
  expect(withHandles(unsized)).toBe(unsized)
  expect(withHandles(anchor)).toBe(anchor)
})
