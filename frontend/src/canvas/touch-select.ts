import {
  useReactFlow,
  useStoreApi,
  type EdgeChange,
  type InternalNode,
  type NodeChange,
  type OnEdgesChange,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react'
import { useCallback, useRef, type PointerEvent } from 'react'
import type { Box } from '@/canvas/snap'
import type { AppEdge, AppNode } from '@/canvas/types'

type Lookup = Map<string, InternalNode<AppNode>>

function boxOf(node: InternalNode<AppNode>): Box {
  const { x, y } = node.internals.positionAbsolute
  const width = node.measured.width ?? node.width ?? 0
  const height = node.measured.height ?? node.height ?? 0
  return { x, y, width, height }
}

const touches = (p: Box, q: Box) =>
  p.x <= q.x + q.width && q.x <= p.x + p.width && p.y <= q.y + q.height && q.y <= p.y + p.height

const covers = (outer: Box, inner: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height

/** A box takes what it touches, and a frame only when it covers the frame whole. */
export function picks(node: InternalNode<AppNode>, box: Box) {
  const own = boxOf(node)
  return node.type === 'frame' ? covers(box, own) : touches(box, own)
}

/** The box from where the drag started, in board coordinates, to the pointer. */
export function boxBetween(start: XYPosition, end: XYPosition): Box {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

/** Drops what xyflow selects past `picks`, and undoes its own early mark on those nodes. */
export function keepPicked(changes: NodeChange<AppNode>[], lookup: Lookup, box: Box) {
  return changes.filter((c) => {
    if (c.type !== 'select' || !c.selected) return true
    const node = lookup.get(c.id)
    if (!node || picks(node, box)) return true
    node.selected = node.internals.userNode.selected
    return false
  })
}

/** An arrow comes with the box only when one of its ends is picked. */
export function keepPickedEdges(
  changes: EdgeChange<AppEdge>[],
  edges: AppEdge[],
  lookup: Lookup,
  box: Box,
) {
  const byId = new Map(edges.map((e) => [e.id, e]))
  const picked = (id: string) => {
    const node = lookup.get(id)
    return !!node && picks(node, box)
  }
  return changes.filter((c) => {
    if (c.type !== 'select' || !c.selected) return true
    const edge = byId.get(c.id)
    return !edge || picked(edge.source) || picked(edge.target)
  })
}

/**
 * Frames whose selection must flip for this box. xyflow tells a frame's change only when the
 * frame enters or leaves the box, not when the box grows over it or shrinks off it.
 */
export function frameFlips(lookup: Lookup, box: Box, boxed: Set<string>) {
  const flips: { id: string; selected: boolean }[] = []
  for (const node of lookup.values()) {
    if (node.type !== 'frame') continue
    const own = boxOf(node)
    const selected = !!node.internals.userNode.selected
    if (!selected && covers(box, own)) flips.push({ id: node.id, selected: true })
    else if (selected && boxed.has(node.id) && !covers(box, own))
      flips.push({ id: node.id, selected: false })
  }
  return flips
}

/** Selection by touch over xyflow's partial mode, with frames taken only when covered. */
export function useTouchSelect() {
  const store = useStoreApi<AppNode, AppEdge>()
  const { screenToFlowPosition } = useReactFlow<AppNode, AppEdge>()
  const pointer = useRef<XYPosition | null>(null)
  // Frames this box selected, so it can drop them again when it shrinks.
  const boxed = useRef(new Set<string>())

  const currentBox = useCallback(() => {
    const rect = store.getState().userSelectionRect
    if (!rect || !pointer.current) return null
    return boxBetween({ x: rect.startX, y: rect.startY }, screenToFlowPosition(pointer.current))
  }, [store, screenToFlowPosition])

  const nodes = useCallback(
    (next: OnNodesChange<AppNode>): OnNodesChange<AppNode> =>
      (changes) => {
        const box = currentBox()
        next(box ? keepPicked(changes, store.getState().nodeLookup, box) : changes)
      },
    [currentBox, store],
  )

  const edges = useCallback(
    (next: OnEdgesChange<AppEdge>): OnEdgesChange<AppEdge> =>
      (changes) => {
        const box = currentBox()
        if (!box) return next(changes)
        const { edges: all, nodeLookup } = store.getState()
        next(keepPickedEdges(changes, all, nodeLookup, box))
      },
    [currentBox, store],
  )

  // Capture runs before xyflow reads the same move, so both see one box.
  const onPointerMoveCapture = useCallback(
    (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY }
      const box = currentBox()
      if (!box) return
      const { nodeLookup, edges: all, triggerNodeChanges, triggerEdgeChanges } = store.getState()
      const flips = frameFlips(nodeLookup, box, boxed.current)
      if (flips.length === 0) return
      for (const f of flips) {
        if (f.selected) boxed.current.add(f.id)
        else boxed.current.delete(f.id)
      }
      triggerNodeChanges(flips.map((f) => ({ type: 'select', id: f.id, selected: f.selected })))
      const flipped = new Map(flips.map((f) => [f.id, f.selected]))
      const picked = (id: string) => {
        const node = nodeLookup.get(id)
        return flipped.get(id) ?? (!!node && picks(node, box))
      }
      const edgeChanges = all
        .filter((e) => flipped.has(e.source) || flipped.has(e.target))
        .map((e) => ({
          id: e.id,
          selected: picked(e.source) || picked(e.target),
          was: !!e.selected,
        }))
        .filter((e) => e.selected !== e.was)
      if (edgeChanges.length)
        triggerEdgeChanges(
          edgeChanges.map(({ id, selected }) => ({ type: 'select', id, selected })),
        )
    },
    [currentBox, store],
  )

  const onSelectionEnd = useCallback(() => boxed.current.clear(), [])

  return { nodes, edges, onPointerMoveCapture, onSelectionEnd }
}
