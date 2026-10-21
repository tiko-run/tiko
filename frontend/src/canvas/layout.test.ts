import { expect, test } from 'vitest'
import { CARD_GUESS, columnPositions } from '@/canvas/layout'

const same = (count: number) => Array.from({ length: count }, () => CARD_GUESS)

test('16 cards make columns of 5, 5, 5 and 1, filled top to bottom', () => {
  const positions = columnPositions(same(16), { x: 0, y: 0 })
  const xs = [...new Set(positions.map((p) => p.x))]
  expect(xs).toHaveLength(4)
  expect(xs.map((x) => positions.filter((p) => p.x === x).length)).toEqual([5, 5, 5, 1])
  expect(positions[1].x).toBe(positions[0].x)
  expect(positions[1].y).toBeGreaterThan(positions[0].y)
  expect(positions[5].y).toBe(positions[0].y)
})

test('the block is centered on the point', () => {
  const positions = columnPositions(same(10), { x: 100, y: 50 })
  const right = Math.max(...positions.map((p) => p.x)) + CARD_GUESS.width
  const bottom = Math.max(...positions.map((p) => p.y)) + CARD_GUESS.height
  expect((positions[0].x + right) / 2).toBe(100)
  expect((positions[0].y + bottom) / 2).toBe(50)
})

test('cards sit 12px apart by their own height, columns 16px after the widest card', () => {
  const sizes = [
    { width: 200, height: 30 },
    { width: 320, height: 90 },
    { width: 100, height: 30 },
    { width: 150, height: 50 },
    { width: 150, height: 30 },
    { width: 120, height: 30 },
  ]
  const p = columnPositions(sizes, { x: 0, y: 0 })
  expect(p[1].y - p[0].y).toBe(30 + 12)
  expect(p[2].y - p[1].y).toBe(90 + 12)
  expect(p[5].x - p[0].x).toBe(320 + 16)
})
