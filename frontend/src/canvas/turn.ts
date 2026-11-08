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
 * Resizes a turned box in its own axes: the grabbed sides move by the pointer's travel since the
 * grab, and the opposite ones stay where they are on the board. `box` is the upright box before
 * turning, as the node stores it.
 */
export function resizeTurned(
  box: Box,
  deg: number,
  sides: Side[],
  travel: XYPosition,
  min: { width: number; height: number },
  keepAspectRatio = false,
): Box {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  // The travel in the box's own axes.
  const local = turnVector(travel, -deg)
  let left = -box.width / 2
  let right = box.width / 2
  let top = -box.height / 2
  let bottom = box.height / 2
  if (sides.includes('left')) left = Math.min(left + local.x, right - min.width)
  if (sides.includes('right')) right = Math.max(right + local.x, left + min.width)
  if (sides.includes('top')) top = Math.min(top + local.y, bottom - min.height)
  if (sides.includes('bottom')) bottom = Math.max(bottom + local.y, top + min.height)
  if (keepAspectRatio) {
    // The dragged side or corner leads; the other axis follows, the far side stays put.
    const ratio = box.width / box.height
    const across = sides.includes('left') || sides.includes('right')
    const along = sides.includes('top') || sides.includes('bottom')
    let w = right - left
    let h = bottom - top
    const leadsAcross = Math.abs(local.x) / box.width >= Math.abs(local.y) / box.height
    if (across && (!along || leadsAcross)) h = w / ratio
    else w = h * ratio
    if (w < min.width) [w, h] = [min.width, min.width / ratio]
    if (h < min.height) [w, h] = [min.height * ratio, min.height]
    if (sides.includes('left')) left = right - w
    else if (sides.includes('right')) right = left + w
    else [left, right] = [(left + right) / 2 - w / 2, (left + right) / 2 + w / 2]
    if (sides.includes('top')) top = bottom - h
    else if (sides.includes('bottom')) bottom = top + h
    else [top, bottom] = [(top + bottom) / 2 - h / 2, (top + bottom) / 2 + h / 2]
  }
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
