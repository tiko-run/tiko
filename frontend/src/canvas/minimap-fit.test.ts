import { expect, test } from 'vitest'
import { boundsOf, fit, HEIGHT, WIDTH } from '@/canvas/minimap-fit'

test('the bounds take in every box', () => {
  expect(
    boundsOf([
      { x: 0, y: 10, width: 100, height: 50 },
      { x: -40, y: 200, width: 20, height: 20 },
    ]),
  ).toEqual({ x: -40, y: 10, width: 140, height: 210 })
  expect(boundsOf([])).toBeNull()
})

const place = (map: ReturnType<typeof fit>, x: number, y: number) => ({
  x: x * map.scale + map.x,
  y: y * map.scale + map.y,
})

test('the board and the view both fit in the minimap, centered', () => {
  const content = { x: 0, y: 0, width: 4000, height: 1000 }
  const view = { x: 1000, y: 200, width: 800, height: 500 }
  const map = fit(content, view)
  const [start, end] = [place(map, 0, 0), place(map, 4000, 1000)]
  expect(start.x).toBeCloseTo(5)
  expect(end.x).toBeCloseTo(WIDTH - 5)
  expect(start.y + end.y).toBeCloseTo(HEIGHT)
})

test('a view far from the board widens the map to show both', () => {
  const content = { x: 0, y: 0, width: 1000, height: 750 }
  const map = fit(content, { x: 5000, y: 0, width: 1000, height: 750 })
  expect(place(map, 0, 0).x).toBeGreaterThanOrEqual(0)
  expect(place(map, 6000, 0).x).toBeLessThanOrEqual(WIDTH)
  expect(map.scale).toBeLessThan(fit(content, content).scale)
})

test('an empty board maps the view alone', () => {
  const view = { x: 0, y: 0, width: 1600, height: 1000 }
  const map = fit(null, view)
  expect(place(map, 800, 500).x).toBeCloseTo(WIDTH / 2)
  expect(place(map, 800, 500).y).toBeCloseTo(HEIGHT / 2)
})
