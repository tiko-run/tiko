import { expect, test } from 'vitest'
import { pointerAngle, turnBy, turned } from '@/canvas/nodes/Rotator'

const center = { x: 100, y: 100 }

test('the pointer angle is measured clockwise from straight up', () => {
  expect(pointerAngle(center, { x: 100, y: 0 })).toBeCloseTo(0)
  expect(pointerAngle(center, { x: 200, y: 100 })).toBeCloseTo(90)
  expect(pointerAngle(center, { x: 100, y: 200 })).toBeCloseTo(180)
  expect(pointerAngle(center, { x: 0, y: 100 })).toBeCloseTo(270)
})

test('the element turns by as much as the grip swept, from where it was grabbed', () => {
  // Grabbed under the element and swept a quarter turn clockwise.
  expect(turnBy(0, 180, 270, false)).toBe(90)
  expect(turnBy(30, 180, 200, false)).toBe(50)
  // Past half a turn it reads the other way round.
  expect(turnBy(170, 0, 30, false)).toBe(-160)
  expect(turnBy(0, 0, 180, false)).toBe(180)
})

test('Shift turns in 15° steps', () => {
  expect(turnBy(0, 0, 20, true)).toBe(15)
  expect(turnBy(0, 0, 23, true)).toBe(30)
})

test('no turn draws no transform', () => {
  expect(turned(undefined)).toBeUndefined()
  expect(turned(0)).toBeUndefined()
  expect(turned(30)).toEqual({ transform: 'rotate(30deg)' })
})
