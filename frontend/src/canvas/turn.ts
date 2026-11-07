import type { XYPosition } from '@xyflow/react'

type Box = { x: number; y: number; width: number; height: number }
export type Side = 'top' | 'right' | 'bottom' | 'left'

const rad = (deg: number) => (deg * Math.PI) / 180

/** A vector turned clockwise by `deg`, in screen axes (y down). */
export function turnVector(v: XYPosition, deg: number): XYPosition {
  const a = rad(deg)
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) }
}

/** The upright box that holds a box turned around its center. */
export function turnedBounds(box: Box, deg: number): Box {
  if (!deg) return box
  const a = rad(deg)
  const width = Math.abs(box.width * Math.cos(a)) + Math.abs(box.height * Math.sin(a))
  const height = Math.abs(box.width * Math.sin(a)) + Math.abs(box.height * Math.cos(a))
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}

/**
 * Resizes a turned box in its own axes: the grabbed sides follow the pointer and the opposite ones
 * stay where they are on the board. `box` is the upright box before turning, as the node stores it.
 */
export function resizeTurned(
  box: Box,
  deg: number,
  sides: Side[],
  pointer: XYPosition,
  min: { width: number; height: number },
): Box {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  // The pointer in the box's own axes, with the center at 0.
  const local = turnVector({ x: pointer.x - center.x, y: pointer.y - center.y }, -deg)
  let left = -box.width / 2
  let right = box.width / 2
  let top = -box.height / 2
  let bottom = box.height / 2
  if (sides.includes('left')) left = Math.min(local.x, right - min.width)
  if (sides.includes('right')) right = Math.max(local.x, left + min.width)
  if (sides.includes('top')) top = Math.min(local.y, bottom - min.height)
  if (sides.includes('bottom')) bottom = Math.max(local.y, top + min.height)
  const width = right - left
  const height = bottom - top
  const shift = turnVector({ x: (left + right) / 2, y: (top + bottom) / 2 }, deg)
  return {
    x: center.x + shift.x - width / 2,
    y: center.y + shift.y - height / 2,
    width,
    height,
  }
}
