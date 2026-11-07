import { expect, test } from 'vitest'
import { degreesLabel, onMagnet, pointerAngle, turnBy, turned } from '@/canvas/nodes/Rotator'

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

test('upright, diagonal and upside down pull the element in from a few degrees away', () => {
  expect(turnBy(0, 0, 3, false)).toBe(0)
  expect(turnBy(0, 0, 5, false)).toBe(5)
  expect(turnBy(0, 0, 42, false)).toBe(45)
  expect(turnBy(0, 0, 88.5, false)).toBe(90)
  expect(turnBy(0, 0, 177, false)).toBe(180)
  expect(turnBy(0, 0, -47, false)).toBe(-45)
  expect(turnBy(0, 0, 30, false)).toBe(30)
})

test('the angle reads counterclockwise as positive and lights up on a pulled angle', () => {
  // Stored clockwise, as CSS turns it: a turn to the left reads positive.
  expect(degreesLabel(-45)).toBe('45°')
  expect(degreesLabel(90)).toBe('−90°')
  expect(degreesLabel(180)).toBe('180°')
  expect(degreesLabel(0)).toBe('0°')
  expect(onMagnet(-90)).toBe(true)
  expect(onMagnet(30)).toBe(false)
})
