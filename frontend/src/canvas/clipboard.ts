import type { XYPosition } from '@xyflow/react'
import type { Task } from '@/api/tasks'
import { absolute } from '@/canvas/frames'
import { nodeTasks } from '@/canvas/node-tasks'
import { taskRef } from '@/canvas/tasks-context'
import type { AppEdge, AppNode } from '@/canvas/types'
import { newId } from '@/lib/id'

/** Copied elements: top-level nodes in absolute positions, frame contents relative to their frame. */
export type Snippet = { nodes: AppNode[]; edges: AppEdge[]; tasks: Record<string, Task> }

// In memory rather than the system clipboard, so copied items also paste into another board.
let buffer: Snippet | null = null
// Written to the system clipboard too, so a paste can tell this copy from text copied later.
let bufferId: string | null = null

/** Keeps the snippet and returns the id that marks it on the system clipboard. */
export function setClipboard(snippet: Snippet) {
  buffer = snippet
  bufferId = newId()
  return bufferId
}

export function clipboardId() {
  return bufferId
}

export function getClipboard() {
  return buffer
}

function persistent({ id, type, position, width, height, parentId, data }: AppNode): AppNode {
  return {
    id,
    type,
    position: { ...position },
    ...(width !== undefined && { width }),
    ...(height !== undefined && { height }),
    ...(parentId !== undefined && { parentId }),
    data: structuredClone(data),
  } as AppNode
}

/** The selection plus everything inside selected frames, and the edges among them. */
export function copySelection(
  nodes: AppNode[],
  edges: AppEdge[],
  tasks: Record<string, Task>,
): Snippet | null {
  const picked = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
  if (picked.size === 0) return null
  for (const node of nodes) if (node.parentId && picked.has(node.parentId)) picked.add(node.id)

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const copied = nodes
    .filter((n) => picked.has(n.id))
    .map((node) => {
      if (node.parentId && picked.has(node.parentId)) return persistent(node)
      const { parentId: _frame, ...rest } = node
      return persistent({ ...rest, position: absolute(node, byId) } as AppNode)
    })
  const cards = copied.flatMap(nodeTasks).flatMap((link) => tasks[taskRef(link)] ?? [])
  return {
    nodes: copied,
    edges: edges
      .filter((e) => picked.has(e.source) && picked.has(e.target))
      .map(({ id, source, target, sourceHandle, targetHandle }) => ({
        id,
        source,
        target,
        ...(sourceHandle && { sourceHandle }),
        ...(targetHandle && { targetHandle }),
      })),
    tasks: Object.fromEntries(cards.map((task) => [taskRef(task), task])),
  }
}

/** Top-left corner of the snippet's top-level nodes. */
export function snippetOrigin(snippet: Snippet): XYPosition {
  const top = snippet.nodes.filter((n) => !n.parentId)
  return {
    x: Math.min(...top.map((n) => n.position.x)),
    y: Math.min(...top.map((n) => n.position.y)),
  }
}

/** A selected copy with fresh ids, its top-level nodes moved by delta. */
export function cloneSnippet(snippet: Snippet, delta: XYPosition): Snippet {
  const ids = new Map(snippet.nodes.map((n) => [n.id, newId()]))
  return {
    nodes: snippet.nodes.map((node) => ({
      ...persistent(node),
      id: ids.get(node.id)!,
      selected: true,
      ...(node.parentId
        ? { parentId: ids.get(node.parentId) }
        : { position: { x: node.position.x + delta.x, y: node.position.y + delta.y } }),
    })) as AppNode[],
    edges: snippet.edges.map((edge) => ({
      ...edge,
      id: newId(),
      source: ids.get(edge.source)!,
      target: ids.get(edge.target)!,
    })),
    tasks: snippet.tasks,
  }
}

/**
 * A drag that copies: the dragged nodes go back to where they started, and the snippet holds
 * copies of them where they were dropped. Null when nothing moved.
 */
export function dragCopy(
  nodes: AppNode[],
  edges: AppEdge[],
  tasks: Record<string, Task>,
  from: Map<string, XYPosition>,
): { nodes: AppNode[]; snippet: Snippet } | null {
  const moved = nodes.some((n) => {
    const start = from.get(n.id)
    return start && (start.x !== n.position.x || start.y !== n.position.y)
  })
  const snippet =
    moved &&
    copySelection(
      nodes.map((n) => ({ ...n, selected: from.has(n.id) })),
      edges,
      tasks,
    )
  if (!snippet) return null
  return {
    nodes: nodes.map((n) => {
      const start = from.get(n.id)
      if (start) return { ...n, position: start, dragging: false }
      return n.dragging ? { ...n, dragging: false } : n
    }),
    snippet,
  }
}

const STAY = 'stay:'
const GHOST = 'drag-ghost'

/** Not a node of the board: a stand-in drawn where a copying drag began. */
export const isStandIn = (id: string) => id.startsWith(STAY)

/**
 * While a drag copies, the originals look as if they stayed: stand-ins sit where the drag began,
 * and the dragged nodes are drawn as ghosts of the copies.
 */
export function withStandIns(nodes: AppNode[], from: Map<string, XYPosition>): AppNode[] {
  const picked = new Set(from.keys())
  const inside = (n: AppNode) => n.parentId !== undefined && picked.has(n.parentId)
  // Each stand-in goes right before its node: after its frame, and under the ghost.
  return nodes.flatMap((n) => {
    if (!picked.has(n.id) && !inside(n)) return [n]
    const standIn = {
      ...n,
      id: STAY + n.id,
      ...(n.parentId && { parentId: inside(n) ? STAY + n.parentId : n.parentId }),
      position: from.get(n.id) ?? n.position,
      selected: false,
      dragging: false,
      draggable: false,
      selectable: false,
      connectable: false,
      className: undefined,
    } as AppNode
    const ghost = { ...n, className: [n.className, GHOST].filter(Boolean).join(' ') }
    return [standIn, ghost]
  })
}

/** The board's own nodes out of what is drawn: no stand-ins, no ghost look. */
export function withoutStandIns(nodes: AppNode[]): AppNode[] {
  return nodes.flatMap((n) => {
    if (isStandIn(n.id)) return []
    if (!n.className?.includes(GHOST)) return [n]
    const rest = n.className
      .split(' ')
      .filter((name) => name !== GHOST)
      .join(' ')
    return [{ ...n, className: rest || undefined }]
  })
}
