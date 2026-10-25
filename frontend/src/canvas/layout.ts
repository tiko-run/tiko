import type { XYPosition } from '@xyflow/react'

type Size = { width: number; height: number }

const PER_COLUMN = 5
const GAP = { x: 16, y: 12 }
// A card is up to 320 px wide and one or two lines tall before it is measured.
export const CARD_GUESS: Size = { width: 320, height: 50 }

/** Top-left corners of cards in columns of five, filled top to bottom, the block centered on a point. */
export function columnPositions(sizes: Size[], center: XYPosition): XYPosition[] {
  const columns: Size[][] = []
  sizes.forEach((size, i) => (columns[Math.floor(i / PER_COLUMN)] ??= []).push(size))
  const widths = columns.map((column) => Math.max(...column.map((s) => s.width)))
  const heights = columns.map(
    (column) => column.reduce((sum, s) => sum + s.height, 0) + (column.length - 1) * GAP.y,
  )
  const total = widths.reduce((sum, w) => sum + w, 0) + (columns.length - 1) * GAP.x
  const top = center.y - Math.max(...heights) / 2
  let x = center.x - total / 2
  return columns.flatMap((column, c) => {
    let y = top
    const placed = column.map((size) => {
      const at = { x, y }
      y += size.height + GAP.y
      return at
    })
    x += widths[c] + GAP.x
    return placed
  })
}
