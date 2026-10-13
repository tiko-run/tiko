import { expect, test } from 'vitest'
import { SHAPES, shapePath, textInset } from '@/canvas/shapes'

test('every shape has a closed outline inside its box', () => {
  for (const { kind } of SHAPES) {
    const path = shapePath(kind, 160, 100)
    expect(path, kind).toMatch(/^M.*Z/)
    const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(Math.min(...numbers), kind).toBeGreaterThanOrEqual(0)
    expect(Math.max(...numbers), kind).toBeLessThanOrEqual(160)
  }
})

test('outlines follow the size of the box', () => {
  expect(shapePath('rectangle', 160, 100)).toBe('M0 0H160V100H0Z')
  expect(shapePath('rhombus', 160, 100)).toBe('M80 0L160 50L80 100L0 50Z')
  expect(shapePath('triangle', 90, 60)).toBe('M45 0L90 60H0Z')
  expect(shapePath('parallelogram', 100, 40)).toBe('M20 0H100L80 40H0Z')
})

test('text keeps clear of slanted and round sides', () => {
  expect(textInset('rectangle')).toBe('0% 0% 0% 0%')
  expect(textInset('rhombus')).toBe('25% 25% 25% 25%')
  expect(textInset('triangle')).toBe('50% 25% 0% 25%')
})
