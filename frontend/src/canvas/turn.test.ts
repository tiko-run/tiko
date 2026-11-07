import { expect, test } from 'vitest'
import { resizeTurned, turnVector, turnedBounds } from '@/canvas/turn'

const box = { x: 0, y: 0, width: 200, height: 100 }
const min = { width: 20, height: 20 }
const close = (a: object, b: object) =>
  Object.entries(b).forEach(([k, v]) => expect((a as Record<string, number>)[k]).toBeCloseTo(v))

test('a quarter turn clockwise takes right to down', () => {
  close(turnVector({ x: 1, y: 0 }, 90), { x: 0, y: 1 })
})

test('the upright box around a turned one', () => {
  close(turnedBounds(box, 90), { x: 50, y: -50, width: 100, height: 200 })
  expect(turnedBounds(box, 0)).toBe(box)
})

test('an upright box resizes as before', () => {
  close(resizeTurned(box, 0, ['right'], { x: 300, y: 40 }, min), {
    x: 0,
    y: 0,
    width: 300,
    height: 100,
  })
  close(resizeTurned(box, 0, ['top', 'left'], { x: -10, y: -20 }, min), {
    x: -10,
    y: -20,
    width: 210,
    height: 120,
  })
})

test('a box turned a quarter grows along its own width, its far side staying put', () => {
  // Turned 90°: its own "right" points down the board, its left side sits at y = -50.
  const next = resizeTurned(box, 90, ['right'], { x: 100, y: 250 }, min)
  close(next, { width: 300, height: 100 })
  // The center moved down by half the growth; the left side is still at y = -50.
  close({ cy: next.y + next.height / 2 }, { cy: 100 })
  close(turnedBounds(next, 90), { y: -50 })
})

test('a side does not pass its opposite side', () => {
  close(resizeTurned(box, 30, ['left'], { x: 1000, y: 0 }, min), { width: 20 })
})
