import { Position, type NodeHandle } from '@xyflow/react'
import { sideInset } from '@/canvas/shapes'
import type { AppNode } from '@/canvas/types'

// The dot React Flow draws, centered on the middle of a side: 6px with its border.
const DOT = 6

const cache = new WeakMap<AppNode, AppNode>()

/**
 * The node with its arrow dots worked out from its size. Far out the dots are not drawn, so
 * React Flow cannot measure them, and arrows would lose their ends without these.
 */
export function withHandles(node: AppNode): AppNode {
  if (node.type === 'anchor' || node.type === 'timer') return node
  const width = node.measured?.width ?? node.width
  const height = node.measured?.height ?? node.height
  if (!width || !height) return node
  const known = cache.get(node)
  if (known) return known
  const inset = node.type === 'shape' ? sideInset(node.data.shape) / 100 : 0
  const dot = (id: string, position: Position, x: number, y: number): NodeHandle => ({
    id,
    type: 'source',
    position,
    x: x - DOT / 2,
    y: y - DOT / 2,
    width: DOT,
    height: DOT,
  })
  const handles = [
    dot('t', Position.Top, width / 2, 0),
    dot('r', Position.Right, width * (1 - inset), height / 2),
    dot('b', Position.Bottom, width / 2, height),
    dot('l', Position.Left, width * inset, height / 2),
  ]
  const next = { ...node, handles } as AppNode
  cache.set(node, next)
  return next
}
