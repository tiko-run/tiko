import { afterEach, expect, test } from 'vitest'
import { minimapLook, readMinimapShown, saveMinimapShown } from '@/canvas/Minimap'
import type { AppNode } from '@/canvas/types'

const node = (type: string, data: Record<string, unknown> = {}) =>
  ({ id: type, type, position: { x: 0, y: 0 }, data }) as AppNode

afterEach(() => localStorage.clear())

test('notes and shapes show their fill, frames an outline, cards a neutral block', () => {
  expect(minimapLook(node('sticky', { color: 'pink' })).fill).toBe('var(--sticky-pink)')
  expect(minimapLook(node('shape', { color: 'none' }))).toEqual({
    fill: 'transparent',
    stroke: 'var(--muted-foreground)',
  })
  expect(minimapLook(node('frame')).fill).toBe('transparent')
  expect(minimapLook(node('task_card')).fill).toBe('var(--muted-foreground)')
})

test('anchors and timers draw nothing', () => {
  expect(minimapLook(node('anchor'))).toEqual({ fill: 'transparent', stroke: 'transparent' })
  expect(minimapLook(node('timer'))).toEqual({ fill: 'transparent', stroke: 'transparent' })
})

test('the minimap is shown until someone hides it, and stays hidden', () => {
  expect(readMinimapShown()).toBe(true)
  saveMinimapShown(false)
  expect(readMinimapShown()).toBe(false)
  saveMinimapShown(true)
  expect(readMinimapShown()).toBe(true)
})
