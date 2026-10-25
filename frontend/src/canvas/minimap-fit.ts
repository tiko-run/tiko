export type Rect = { x: number; y: number; width: number; height: number }

export const WIDTH = 200
export const HEIGHT = 150
// Space around the content, in minimap pixels, as React Flow's own minimap leaves.
const MARGIN = 5

/** The box around every element that shows on the minimap, in board coordinates. */
export function boundsOf(boxes: Rect[]): Rect | null {
  if (boxes.length === 0) return null
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.width)
    y1 = Math.max(y1, b.y + b.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * How the board maps onto the minimap: the content and the view both fit, centered.
 * A board point p lands at `p * scale + offset` minimap pixels.
 */
export function fit(content: Rect | null, view: Rect) {
  const all = content ? (boundsOf([content, view]) as Rect) : view
  // A view not laid out yet has no size: it maps one to one rather than to infinity.
  const span = (room: number, size: number) => (size > 0 ? (room - 2 * MARGIN) / size : 1)
  const scale = Math.min(span(WIDTH, all.width), span(HEIGHT, all.height))
  return {
    scale,
    x: (WIDTH - all.width * scale) / 2 - all.x * scale,
    y: (HEIGHT - all.height * scale) / 2 - all.y * scale,
  }
}
