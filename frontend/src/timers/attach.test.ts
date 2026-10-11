import { expect, test } from 'vitest'
import { absolute, framesFirst, reparent, splitDeletion } from '@/canvas/frames'
import type { AppNode } from '@/canvas/types'
import { BESIDE, dropTimers } from './attach'

const frame: AppNode = {
  id: 'f',
  type: 'frame',
  position: { x: 100, y: 100 },
  width: 400,
  height: 300,
  data: { title: 'Q4' },
}

function card(id: string, x: number, y: number, parentId?: string): AppNode {
  return {
    id,
    type: 'task_card',
    position: { x, y },
    measured: { width: 100, height: 40 },
    ...(parentId && { parentId }),
    data: { key: 'DEMO-1' },
  }
}

function timer(id: string, x: number, y: number, parentId?: string): AppNode {
  return {
    id,
    type: 'timer',
    position: { x, y },
    width: 40,
    height: 40,
    ...(parentId && { parentId }),
    data: { note: '', dueAt: '2026-10-07T08:30:00.000Z' },
  }
}

const byId = (nodes: AppNode[]) => new Map(nodes.map((n) => [n.id, n]))

test('a timer dropped on a card attaches beside its top edge', () => {
  const [, attached] = dropTimers([card('a', 0, 0), timer('t', 40, 0)], ['t'])
  expect(attached).toMatchObject({ parentId: 'a', position: BESIDE })
})

test('a timer moved near its card stays attached where it was dropped', () => {
  const nodes = [card('a', 0, 0), timer('t', 110, 0, 'a')]
  expect(dropTimers(nodes, ['t'])).toBe(nodes)
})

test('a timer dragged away from its card comes free at the same place', () => {
  const [, free] = dropTimers([card('a', 50, 50), timer('t', 300, 0, 'a')], ['t'])
  expect(free.parentId).toBeUndefined()
  expect(free.position).toEqual({ x: 350, y: 50 })
})

test('a free timer joins a frame like any element, an attached one does not', () => {
  const [, free] = reparent([frame, timer('t', 150, 150)], ['t'])
  expect(free.parentId).toBe('f')
  const attached = [frame, card('a', 900, 900), timer('t', -46, 0, 'a')]
  expect(reparent(attached, ['t'])).toBe(attached)
})

test('a timer on a card in a frame adds up both parents', () => {
  const nodes = [frame, card('a', 10, 20, 'f'), timer('t', -46, 0, 'a')]
  expect(absolute(nodes[2], byId(nodes))).toEqual({ x: 64, y: 120 })
})

test('timers go after every other node', () => {
  const order = framesFirst([timer('t', 0, 0), card('a', 0, 0), frame]).map((n) => n.id)
  expect(order).toEqual(['f', 'a', 't'])
})

test('deleting a card takes its timer, deleting a frame keeps a card and its timer', () => {
  // xyflow passes the selected nodes plus their children.
  const selectedCard = [{ ...card('a', 0, 0), selected: true }, timer('t', -46, 0, 'a')]
  expect(splitDeletion(selectedCard, [])).toBeNull()

  const selectedFrame = [
    { ...frame, selected: true },
    card('a', 10, 20, 'f'),
    timer('t', 0, 0, 'a'),
  ]
  expect(splitDeletion(selectedFrame, [])?.nodes.map((n) => n.id)).toEqual(['f'])
})
