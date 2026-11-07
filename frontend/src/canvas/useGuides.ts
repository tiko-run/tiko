import {
  useKeyPress,
  useStoreApi,
  type InternalNode,
  type NodeChange,
  type NodeDimensionChange,
  type NodePositionChange,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react'
import { useCallback, useRef, useState } from 'react'
import { matchSize, snap, type Box, type Guide } from '@/canvas/snap'
import type { AppNode } from '@/canvas/types'

// How close in screen pixels an edge or size must come before it snaps, at any zoom.
const THRESHOLD_PX = 6
// How far size bars sit from the boxes they measure, in screen pixels.
const INSET_PX = 8

type Drag = NodePositionChange & { position: XYPosition }
type Resize = {
  size: NodeDimensionChange & { dimensions: { width: number; height: number } }
  move?: NodePositionChange
}

function boxOf(node: InternalNode<AppNode>): Box {
  const { x, y } = node.internals.positionAbsolute
  return { x, y, width: node.measured.width ?? 0, height: node.measured.height ?? 0 }
}

const intersects = (p: Box, q: Box) =>
  p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height

function asDrag(changes: NodeChange<AppNode>[]): Drag | undefined {
  const [change] = changes
  return changes.length === 1 && change.type === 'position' && change.dragging && change.position
    ? (change as Drag)
    : undefined
}

// A resize handle sends the new size, plus the new position when it moves the top or left edge.
function asResize(changes: NodeChange<AppNode>[]): Resize | undefined {
  const size = changes.find(
    (c): c is NodeDimensionChange => c.type === 'dimensions' && c.resizing === true,
  )
  if (!size?.dimensions) return undefined
  const rest = changes.filter((c) => c !== size)
  const move = rest.find((c): c is NodePositionChange => c.type === 'position' && c.id === size.id)
  if (rest.length > (move ? 1 : 0)) return undefined
  return { size: size as Resize['size'], move }
}

/**
 * Snaps a node dragged or resized alone to the others on screen and returns the guides to
 * draw; Cmd or Ctrl turns it off. Arrow anchors take no part.
 */
export function useGuides(onNodesChange: OnNodesChange<AppNode>) {
  const store = useStoreApi<AppNode>()
  const free = useKeyPress(['Meta', 'Control'])
  const [guides, setGuides] = useState<Guide[]>([])
  // xyflow ends a drag or resize with its own unsnapped values; the last snapped ones replace them.
  const last = useRef<{ id: string; position?: XYPosition; width?: number; height?: number }>(null)

  const onChange = useCallback<OnNodesChange<AppNode>>(
    (changes) => {
      const drag = asDrag(changes)
      const resize = drag ? undefined : asResize(changes)
      const id = drag?.id ?? resize?.size.id
      const { nodeLookup, transform, width, height } = store.getState()
      const found = id ? nodeLookup.get(id) : undefined
      // An arrow's free end points at an exact spot, so it neither snaps nor attracts others.
      const node = found?.type === 'anchor' ? undefined : found
      if (!node || free || (!drag && !resize)) {
        setGuides((current) => (current.length ? [] : current))
        const snapped = last.current
        if (!snapped) return onNodesChange(changes)
        return onNodesChange(
          changes.map((c) => {
            if (c.type === 'position' && c.id === snapped.id && c.dragging === false) {
              last.current = null
              return snapped.position && !free ? { ...c, position: snapped.position } : c
            }
            if (c.type === 'dimensions' && c.id === snapped.id && c.resizing === false) {
              last.current = null
              return snapped.width !== undefined && snapped.height !== undefined && !free
                ? { ...c, dimensions: { width: snapped.width, height: snapped.height } }
                : c
            }
            return c
          }),
        )
      }

      const [tx, ty, zoom] = transform
      const view = { x: -tx / zoom, y: -ty / zoom, width: width / zoom, height: height / zoom }
      const others: Box[] = []
      for (const other of nodeLookup.values()) {
        if (
          other.id === node.id ||
          other.parentId === node.id ||
          other.hidden ||
          other.type === 'anchor'
        )
          continue
        const box = boxOf(other)
        if (box.width && box.height && intersects(box, view)) others.push(box)
      }
      const parent = node.parentId ? nodeLookup.get(node.parentId) : undefined
      const offset = parent?.internals.positionAbsolute ?? { x: 0, y: 0 }
      const threshold = THRESHOLD_PX / zoom

      if (drag) {
        const moving = {
          ...boxOf(node),
          x: drag.position.x + offset.x,
          y: drag.position.y + offset.y,
        }
        const result = snap(moving, others, threshold)
        const position = { x: result.x - offset.x, y: result.y - offset.y }
        last.current = { id: node.id, position }
        setGuides(result.guides)
        return onNodesChange([{ ...drag, position }])
      }

      const { size, move } = resize!
      const position = move?.position ?? node.position
      const box = {
        x: position.x + offset.x,
        y: position.y + offset.y,
        width: size.dimensions.width,
        height: size.dimensions.height,
      }
      const result = matchSize(box, others, threshold, INSET_PX / zoom, {
        width: box.width !== node.measured.width,
        height: box.height !== node.measured.height,
      })
      setGuides(result.guides)
      const next: NodeChange<AppNode>[] = [
        { ...size, dimensions: { width: result.width, height: result.height } },
      ]
      last.current = { id: node.id, width: result.width, height: result.height }
      if (move) {
        // Dragging the left or top edge keeps the opposite edge in place.
        const fromLeft = position.x !== node.position.x
        const fromTop = position.y !== node.position.y
        next.unshift({
          ...move,
          position: {
            x: fromLeft ? position.x + box.width - result.width : position.x,
            y: fromTop ? position.y + box.height - result.height : position.y,
          },
        })
      }
      onNodesChange(next)
    },
    [store, free, onNodesChange],
  )

  return { onNodesChange: onChange, guides }
}
