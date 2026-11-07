import { getBezierPath, Position } from '@xyflow/react'
import { expect, test } from 'vitest'
import { turnedBezier } from '@/canvas/TurnedEdge'

const numbers = (path: string) => path.match(/-?\d+(\.\d+)?/g)!.map(Number)

test('between upright elements the arrow is the same curve as before', () => {
  const [ours] = [
    turnedBezier({ x: 0, y: 0 }, Position.Right, 0, { x: 300, y: 80 }, Position.Left, 0),
  ]
  const [theirs] = getBezierPath({
    sourceX: 0,
    sourceY: 0,
    sourcePosition: Position.Right,
    targetX: 300,
    targetY: 80,
    targetPosition: Position.Left,
  })
  expect(numbers(ours)).toEqual(numbers(theirs))
})

test('an end on a turned element leaves along that element’s turned side', () => {
  // A left side turned a quarter clockwise faces up.
  const [, , c1x, c1y] = numbers(
    turnedBezier({ x: 0, y: 0 }, Position.Left, 90, { x: 0, y: -200 }, Position.Bottom, 0),
  )
  expect(c1x).toBeCloseTo(0)
  expect(c1y).toBeLessThan(0)
})
