import { expect, test } from 'vitest'
import type { AppNode } from '@/canvas/types'
import { at, plan, show, type Motion } from '@/live/motion'

const node = (id: string, x = 0, extra: Partial<AppNode> = {}): AppNode =>
  ({
    id,
    type: 'sticky',
    position: { x, y: 0 },
    data: { text: '', color: 'yellow' },
    ...extra,
  }) as AppNode

const STILL: Motion = new Map()
const NO_DRAGS = new Map<string, { x: number; y: number }>()
const NOBODY = new Set<string>()
const noOrigin = () => undefined
const was = (...nodes: AppNode[]) =>
  new Map(
    nodes.map((n) => [
      n.id,
      { x: n.position.x, y: n.position.y, width: n.width, height: n.height },
    ]),
  )

test('a change that arrived from someone else glides from where the node was', () => {
  const before = node('a', 0)
  const after = node('a', 100)
  const motion = plan([after], NO_DRAGS, new Set(['a']), STILL, was(before), 1000, noOrigin)
  expect(show([after], motion, 1000)[0].position.x).toBe(0)
  const half = show([after], motion, 1075)[0].position.x
  expect(half).toBeGreaterThan(50)
  expect(half).toBeLessThan(100)
  expect(show([after], motion, 1150)[0].position.x).toBe(100)
  // Once it has arrived there is nothing left to animate, and the nodes pass through as they are.
  const done = plan([after], NO_DRAGS, new Set(['a']), motion, was(after), 1200, noOrigin)
  expect(done.size).toBe(0)
  expect(show([after], done, 1200)).toEqual([after])
})

test('the person own change is never animated', () => {
  const after = node('a', 100)
  expect(plan([after], NO_DRAGS, NOBODY, STILL, was(node('a', 0)), 1000, noOrigin)).toBe(STILL)
  const mine = [after]
  expect(show(mine, STILL, 1000)).toBe(mine)
})

test('a node someone drags moves evenly to each new place and stays held there', () => {
  const a = node('a', 0)
  let motion = plan([a], new Map([['a', { x: 40, y: 0 }]]), NOBODY, STILL, was(a), 1000, noOrigin)
  expect(show([a], motion, 1040)[0].position.x).toBe(20)
  // The next update comes mid-way: the node goes on from where it is, without a jump.
  motion = plan([a], new Map([['a', { x: 80, y: 0 }]]), NOBODY, motion, was(a), 1040, noOrigin)
  expect(show([a], motion, 1040)[0].position.x).toBe(20)
  expect(show([a], motion, 1120)[0].position.x).toBe(80)
  // The drag pauses: the board still has the node at its old place, the screen keeps it held.
  const held = plan([a], new Map([['a', { x: 80, y: 0 }]]), NOBODY, motion, was(a), 5000, noOrigin)
  expect(show([a], held, 5000)[0].position.x).toBe(80)
  expect(a.position.x).toBe(0)
})

test('in a busy room a dragged node takes the longer time between two places', () => {
  const a = node('a', 0)
  const drags = new Map([['a', { x: 40, y: 0 }]])
  const motion = plan([a], drags, NOBODY, STILL, was(a), 1000, noOrigin, false, 160)
  expect(show([a], motion, 1080)[0].position.x).toBe(20)
  expect(show([a], motion, 1160)[0].position.x).toBe(40)
})

test('a child is placed inside its frame, and what this person drags is theirs', () => {
  const child = node('in', 10, { parentId: 'f' })
  const mine = node('mine', 0, { dragging: true })
  const drags = new Map([
    ['in', { x: 130, y: 0 }],
    ['mine', { x: 999, y: 0 }],
  ])
  const motion = plan([child, mine], drags, NOBODY, STILL, was(child, mine), 0, (id) =>
    id === 'f' ? { x: 100, y: 0 } : undefined,
  )
  const shown = show([child, mine], motion, 80)
  expect(shown[0].position.x).toBe(30)
  expect(shown[1]).toBe(mine)
})

test('a resize by someone else glides too, and reduced motion jumps', () => {
  const before = node('a', 0, { width: 100, height: 100 })
  const after = node('a', 0, { width: 300, height: 100 })
  const motion = plan([after], NO_DRAGS, new Set(['a']), STILL, was(before), 0, noOrigin)
  expect(at(motion.get('a')!, 0).width).toBe(100)
  expect(at(motion.get('a')!, 150).width).toBe(300)
  const instant = plan([after], NO_DRAGS, new Set(['a']), STILL, was(before), 0, noOrigin, true)
  expect(show([after], instant, 0)[0].width).toBe(300)
})
