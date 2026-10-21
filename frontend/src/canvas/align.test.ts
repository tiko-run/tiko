import { expect, test } from 'vitest'
import { alignShifts, applyShifts, boxesOf, distributeShifts, movers } from '@/canvas/align'
import type { AppNode } from '@/canvas/types'

const note = (id: string, x: number, y: number, w = 100, h = 50, extra = {}) =>
  ({
    id,
    type: 'sticky',
    position: { x, y },
    measured: { width: w, height: h },
    selected: true,
    data: { text: '' },
    ...extra,
  }) as AppNode

const frame = (id: string, x: number, y: number, selected = false) =>
  ({
    id,
    type: 'frame',
    position: { x, y },
    measured: { width: 500, height: 400 },
    selected,
    data: {},
  }) as AppNode

const run = (nodes: AppNode[], shifts: Map<string, { x: number; y: number }>) => {
  const moved = applyShifts(nodes, shifts)
  return boxesOf(movers(moved), moved)
}

test('align left and bottom line up on the box around the selection', () => {
  const nodes = [note('a', 10, 0), note('b', 50, 100, 100, 80), note('c', 30, 40)]
  const boxes = boxesOf(movers(nodes), nodes)
  expect(run(nodes, alignShifts(boxes, 'left')).map((b) => b.x)).toEqual([10, 10, 10])
  const bottoms = run(nodes, alignShifts(boxes, 'bottom')).map((b) => b.y + b.height)
  expect(bottoms).toEqual([180, 180, 180])
})

test('center and middle use the middle of the box', () => {
  const nodes = [note('a', 0, 0, 100), note('b', 200, 0, 50)]
  const boxes = boxesOf(movers(nodes), nodes)
  const after = run(nodes, alignShifts(boxes, 'center'))
  expect(after.map((b) => b.x + b.width / 2)).toEqual([125, 125])
})

test('elements inside a frame line up on the board, not inside the frame', () => {
  const nodes = [
    frame('f', 1000, 0),
    note('a', 20, 20, 100, 50, { parentId: 'f' }),
    note('b', 300, 200),
  ]
  const after = run(nodes, alignShifts(boxesOf(movers(nodes), nodes), 'left'))
  expect(after.map((b) => b.x)).toEqual([300, 300])
})

test('a child of a selected frame does not move on its own', () => {
  const nodes = [frame('f', 0, 0, true), note('a', 20, 20, 100, 50, { parentId: 'f' })]
  expect(movers(nodes).map((n) => n.id)).toEqual(['f'])
})

test('distribute keeps the outer ones and makes the gaps equal', () => {
  const nodes = [note('a', 0, 0, 100), note('b', 130, 0, 40), note('c', 400, 0, 100)]
  const after = run(nodes, distributeShifts(boxesOf(movers(nodes), nodes), 'horizontal'))
  const [a, b, c] = after
  expect(a.x).toBe(0)
  expect(c.x).toBe(400)
  expect(b.x - (a.x + a.width)).toBe(c.x - (b.x + b.width))
})

test('distribute keeps the leftmost box when a narrow one sits inside it', () => {
  const nodes = [note('a', 0, 0, 300), note('b', 100, 0, 10), note('c', 400, 0, 100)]
  const after = run(nodes, distributeShifts(boxesOf(movers(nodes), nodes), 'horizontal'))
  expect(after.find((b) => b.id === 'a')?.x).toBe(0)
  expect(after.find((b) => b.id === 'c')?.x).toBe(400)
})
