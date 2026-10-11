import type { BoardDoc } from '@/api/boards'
import type { AppEdge, AppNode } from '@/canvas/types'

/** A node as the shared document keeps it: every key is one value, replaced as a whole. */
export type StoredNode = {
  type: string
  place: { x: number; y: number; parentId?: string }
  size: { width?: number; height?: number }
  order: number
  data: Record<string, unknown>
}
export type StoredEdge = {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}
export type DocNode = BoardDoc['nodes'][number]
export type DocEdge = BoardDoc['edges'][number]

// Only persistent fields: xyflow adds selected, dragging, measured and more at runtime.
export function toDoc(nodes: AppNode[], edges: AppEdge[]): Pick<BoardDoc, 'nodes' | 'edges'> {
  return {
    nodes: nodes.map(({ id, type, position, width, height, parentId, data }) => ({
      id,
      type: type ?? 'task_card',
      position: { x: position.x, y: position.y },
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
      ...(parentId !== undefined && { parentId }),
      data,
    })),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({
      id,
      source,
      target,
      ...(sourceHandle && { sourceHandle }),
      ...(targetHandle && { targetHandle }),
    })),
  }
}

export function storedNode(node: DocNode, order: number): StoredNode {
  return {
    type: node.type,
    place: {
      x: node.position.x,
      y: node.position.y,
      ...(node.parentId !== undefined && { parentId: node.parentId }),
    },
    size: {
      ...(node.width !== undefined && { width: node.width }),
      ...(node.height !== undefined && { height: node.height }),
    },
    order,
    data: node.data,
  }
}

export function storedEdge({
  source,
  target,
  sourceHandle,
  targetHandle,
}: Pick<AppEdge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>): StoredEdge {
  return {
    source,
    target,
    ...(sourceHandle && { sourceHandle }),
    ...(targetHandle && { targetHandle }),
  }
}

// What a card was called before trackers could be mixed. A tab left open over the upgrade
// still adds cards under it, until the server renames them.
const LEGACY_CARD = 'jira_card'

export function jsonNode(id: string, node: StoredNode): DocNode {
  return {
    id,
    type: (node.type === LEGACY_CARD ? 'task_card' : node.type) as DocNode['type'],
    position: { x: node.place.x, y: node.place.y },
    data: node.data,
    ...(node.place.parentId !== undefined && { parentId: node.place.parentId }),
    ...(node.size.width !== undefined && { width: node.size.width }),
    ...(node.size.height !== undefined && { height: node.size.height }),
  }
}

/** Whether a value read from the shared document has the shape of a node. */
export function isStoredNode(value: unknown): value is StoredNode {
  const node = value as Partial<StoredNode> | null
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof node.type === 'string' &&
    typeof node.order === 'number' &&
    typeof node.place === 'object' &&
    node.place !== null &&
    typeof node.place.x === 'number' &&
    typeof node.place.y === 'number' &&
    typeof node.size === 'object' &&
    node.size !== null &&
    typeof node.data === 'object' &&
    node.data !== null
  )
}

/**
 * Nodes by stacking order with every child right after its parent, as xyflow needs; edges by id.
 * The same projection as `to_json` in backend/app/domain/live.py, checked by shared fixtures.
 * A node whose parent is missing is left out until the server's repair brings it back.
 */
export function toJson(
  nodes: Record<string, StoredNode>,
  edges: Record<string, StoredEdge>,
): { nodes: DocNode[]; edges: DocEdge[] } {
  const children = new Map<string | undefined, string[]>()
  for (const [id, node] of Object.entries(nodes)) {
    const siblings = children.get(node.place.parentId)
    if (siblings) siblings.push(id)
    else children.set(node.place.parentId, [id])
  }
  const byOrder = (a: string, b: string) =>
    nodes[a].order - nodes[b].order || (a < b ? -1 : a > b ? 1 : 0)
  for (const ids of children.values()) ids.sort(byOrder)
  const out: DocNode[] = []
  const stack = [...(children.get(undefined) ?? [])].reverse()
  while (stack.length) {
    const id = stack.pop()!
    out.push(jsonNode(id, nodes[id]))
    stack.push(...[...(children.get(id) ?? [])].reverse())
  }
  return {
    nodes: out,
    edges: Object.keys(edges)
      .sort()
      .map((id) => ({ id, ...edges[id] })),
  }
}

/** JSON with sorted keys, so two equal values always give the same text. */
export function canon(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canon(record[key])}`).join(',')}}`
}
