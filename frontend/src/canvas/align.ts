import type { XYPosition } from '@xyflow/react'
import { absolute } from '@/canvas/frames'
import type { AppNode } from '@/canvas/types'

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type Distribution = 'horizontal' | 'vertical'

type Box = { id: string; x: number; y: number; width: number; height: number }

/** The selected nodes that move on their own: a child of a selected frame moves with the frame. */
export function movers(nodes: AppNode[]): AppNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const insideSelected = (node: AppNode): boolean => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    return parent ? parent.selected === true || insideSelected(parent) : false
  }
  return nodes.filter((n) => n.selected && n.type !== 'anchor' && !insideSelected(n))
}

export function boxesOf(moving: AppNode[], all: AppNode[]): Box[] {
  const byId = new Map(all.map((n) => [n.id, n]))
  return moving.map((n) => ({
    id: n.id,
    ...absolute(n, byId),
    width: n.measured?.width ?? n.width ?? 0,
    height: n.measured?.height ?? n.height ?? 0,
  }))
}

/** How far each box moves to line up with the box around all of them. */
export function alignShifts(boxes: Box[], how: Alignment): Map<string, XYPosition> {
  const left = Math.min(...boxes.map((b) => b.x))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const top = Math.min(...boxes.map((b) => b.y))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  const target = (b: Box): XYPosition => {
    switch (how) {
      case 'left':
        return { x: left, y: b.y }
      case 'center':
        return { x: (left + right - b.width) / 2, y: b.y }
      case 'right':
        return { x: right - b.width, y: b.y }
      case 'top':
        return { x: b.x, y: top }
      case 'middle':
        return { x: b.x, y: (top + bottom - b.height) / 2 }
      case 'bottom':
        return { x: b.x, y: bottom - b.height }
    }
  }
  return new Map(boxes.map((b) => [b.id, shift(b, target(b))]))
}

/** Equal gaps along one axis; the two outermost boxes stay where they are. */
export function distributeShifts(boxes: Box[], axis: Distribution): Map<string, XYPosition> {
  const start = (b: Box) => (axis === 'horizontal' ? b.x : b.y)
  const length = (b: Box) => (axis === 'horizontal' ? b.width : b.height)
  const sorted = boxes.toSorted((a, b) => start(a) + length(a) / 2 - (start(b) + length(b) / 2))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const used = sorted.reduce((sum, b) => sum + length(b), 0)
  const gap = (start(last) + length(last) - start(first) - used) / (sorted.length - 1)
  let at = start(first)
  return new Map(
    sorted.map((b) => {
      const to = axis === 'horizontal' ? { x: at, y: b.y } : { x: b.x, y: at }
      at += length(b) + gap
      return [b.id, shift(b, to)]
    }),
  )
}

// Whole pixels, so aligned edges stay crisp.
function shift(b: Box, to: XYPosition): XYPosition {
  return { x: Math.round(to.x - b.x), y: Math.round(to.y - b.y) }
}

/** Moves nodes by their shifts; a shift works the same inside a frame and outside one. */
export function applyShifts(nodes: AppNode[], shifts: Map<string, XYPosition>): AppNode[] {
  return nodes.map((n) => {
    const d = shifts.get(n.id)
    return d && (d.x || d.y)
      ? { ...n, position: { x: n.position.x + d.x, y: n.position.y + d.y } }
      : n
  })
}
