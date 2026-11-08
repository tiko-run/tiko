import * as Y from 'yjs'
import type { AppEdge, AppNode } from '@/canvas/types'
import {
  canon,
  isStoredNode,
  storedEdge,
  storedNode,
  toDoc,
  toJson,
  type StoredEdge,
  type StoredNode,
} from '@/live/doc'

/** Transaction origin of this tab's own edits: what its undo history covers. */
export const LOCAL = 'local'
/** Origin of what this tab writes but nobody did: a finished upload is not an edit to undo. */
export const UNTRACKED = 'untracked'

type Content = Omit<StoredNode, 'order'>
type Seen = { text: string; content: Content }

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const contentOf = ({ type, place, size, data }: StoredNode): Content => ({
  type,
  place,
  size,
  data,
})

/**
 * Keeps the canvas state and the shared document in step.
 *
 * `push` writes what the person changed since the state this tab last saw, field by field;
 * `pull` folds other people's changes into the canvas state. What a tab "last saw" is kept
 * per element, so a change that is still on its way in either direction is never undone.
 */
export class LiveBinding {
  readonly nodes: Y.Map<Y.Map<unknown>>
  readonly edges: Y.Map<StoredEdge>
  /** Viewers pull only. */
  canWrite = true
  private seenNodes = new Map<string, Seen>()
  private seenOrder = new Map<string, number>()
  private seenEdges = new Map<string, string>()
  private texts = new WeakMap<AppNode, Seen>()
  private snapshot: {
    nodes: Record<string, StoredNode>
    edges: Record<string, StoredEdge>
  } | null = null

  readonly doc: Y.Doc

  constructor(doc: Y.Doc, onRemote: () => void = () => {}) {
    this.doc = doc
    this.nodes = doc.getMap('nodes')
    this.edges = doc.getMap('edges')
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      if (transaction.changed.size === 0) return
      this.snapshot = null
      if (transaction.origin !== LOCAL) onRemote()
    })
  }

  private read() {
    if (this.snapshot) return this.snapshot
    const nodes: Record<string, StoredNode> = {}
    this.nodes.forEach((map, id) => {
      if (!(map instanceof Y.Map) || !(map.get('data') instanceof Y.Map)) return
      const value: unknown = map.toJSON()
      if (isStoredNode(value)) nodes[id] = value
    })
    // An arrow to a node this tab cannot draw is left out with it.
    const shown = new Set(toJson(nodes, {}).nodes.map((node) => node.id))
    const visible: Record<string, StoredNode> = {}
    for (const id of shown) visible[id] = nodes[id]
    const edges: Record<string, StoredEdge> = {}
    this.edges.forEach((edge, id) => {
      if (edge && shown.has(edge.source) && shown.has(edge.target)) edges[id] = edge
    })
    return (this.snapshot = { nodes: visible, edges })
  }

  private local(node: AppNode): Seen {
    let seen = this.texts.get(node)
    if (!seen) {
      const content = contentOf(storedNode(toDoc([node], []).nodes[0], 0))
      seen = { text: canon(content), content }
      this.texts.set(node, seen)
    }
    return seen
  }

  /** The board as the shared document has it; what the canvas shows after the first sync. */
  reset(): { nodes: AppNode[]; edges: AppEdge[] } {
    const { nodes, edges } = this.read()
    this.seenNodes.clear()
    this.seenOrder.clear()
    this.seenEdges.clear()
    for (const [id, node] of Object.entries(nodes)) {
      const content = contentOf(node)
      this.seenNodes.set(id, { text: canon(content), content })
      this.seenOrder.set(id, node.order)
    }
    for (const [id, edge] of Object.entries(edges)) this.seenEdges.set(id, canon(edge))
    const json = toJson(nodes, edges)
    return { nodes: json.nodes as AppNode[], edges: json.edges }
  }

  /** The canvas nodes with other people's changes folded in; the same array when none apply. */
  pullNodes(local: AppNode[]): AppNode[] {
    const remote = this.read().nodes
    const mine = new Map(local.map((node) => [node.id, node]))
    const out: AppNode[] = []
    for (const doc of toJson(remote, {}).nodes) {
      const node = mine.get(doc.id)
      const seen = this.seenNodes.get(doc.id)
      if (!node) {
        // Deleted here and not written yet: it must not come back.
        if (!seen) out.push(doc as AppNode)
        continue
      }
      const text = this.local(node).text
      const pending = seen !== undefined && seen.text !== text
      if (node.dragging || pending || text === canon(contentOf(remote[doc.id]))) {
        out.push(node)
        continue
      }
      const { width, height, parentId } = doc
      out.push({ ...node, ...doc, width, height, parentId } as AppNode)
    }
    // Added here and not written yet.
    for (const node of local) if (!remote[node.id] && !this.seenNodes.has(node.id)) out.push(node)
    return same(out, local) ? local : out
  }

  pullEdges(local: AppEdge[]): AppEdge[] {
    const remote = this.read().edges
    const mine = new Map(local.map((edge) => [edge.id, edge]))
    const out: AppEdge[] = []
    for (const id of Object.keys(remote).sort()) {
      const edge = mine.get(id)
      const seen = this.seenEdges.get(id)
      if (!edge) {
        if (seen === undefined) out.push({ id, ...remote[id] })
        continue
      }
      const text = canon(storedEdge(edge))
      const pending = seen !== undefined && seen !== text
      if (pending || text === canon(remote[id])) {
        out.push(edge)
        continue
      }
      const { source, target, sourceHandle, targetHandle } = remote[id]
      out.push({ ...edge, source, target, sourceHandle, targetHandle })
    }
    for (const edge of local) if (!remote[edge.id] && !this.seenEdges.has(edge.id)) out.push(edge)
    return same(out, local) ? local : out
  }

  /** Writes what changed on the canvas since this tab last saw the document. */
  push(nodes: AppNode[], edges: AppEdge[]): void {
    const remote = this.read()
    const ops: (() => void)[] = []
    const orders = this.canWrite ? this.reorder(nodes, remote.nodes) : new Map<string, number>()

    const here = new Set<string>()
    for (const node of nodes) {
      here.add(node.id)
      if (node.dragging) continue
      const { text, content } = this.local(node)
      const seen = this.seenNodes.get(node.id)
      const there = remote.nodes[node.id]
      if (seen?.text !== text) {
        if (there && canon(contentOf(there)) === text) {
          this.seenNodes.set(node.id, { text, content })
        } else if (this.canWrite && !(seen && !there)) {
          // `seen && !there`: someone deleted it; the pull takes it off the canvas.
          const order = orders.get(node.id) ?? there?.order ?? 0
          ops.push(() => this.writeNode(node.id, content, seen?.content, order))
          this.seenNodes.set(node.id, { text, content })
          orders.delete(node.id)
        }
      }
    }
    for (const [id, order] of orders) {
      if (remote.nodes[id]) ops.push(() => this.nodes.get(id)?.set('order', order))
    }
    for (const id of [...this.seenNodes.keys()]) {
      if (here.has(id)) continue
      // Still shown to others means it was deleted here; hidden or gone means it left by itself.
      if (this.canWrite && remote.nodes[id]) ops.push(() => this.nodes.delete(id))
      this.seenNodes.delete(id)
      this.seenOrder.delete(id)
    }

    const edgesHere = new Set<string>()
    for (const edge of edges) {
      edgesHere.add(edge.id)
      const stored = storedEdge(edge)
      const text = canon(stored)
      const seen = this.seenEdges.get(edge.id)
      if (seen === text) continue
      const there = remote.edges[edge.id]
      if (there && canon(there) === text) {
        this.seenEdges.set(edge.id, text)
      } else if (this.canWrite && !(seen !== undefined && !there)) {
        ops.push(() => this.edges.set(edge.id, plain(stored)))
        this.seenEdges.set(edge.id, text)
      }
    }
    for (const id of [...this.seenEdges.keys()]) {
      if (edgesHere.has(id)) continue
      if (this.canWrite && remote.edges[id]) ops.push(() => this.edges.delete(id))
      this.seenEdges.delete(id)
    }

    if (ops.length) this.doc.transact(() => ops.forEach((op) => op()), LOCAL)
  }

  /**
   * Sets fields of a node's data outside the undo history, `undefined` clearing one; the
   * canvas takes them in as it takes in other people's changes. False when the node is not
   * on the board.
   */
  patchData(id: string, patch: Record<string, unknown>): boolean {
    const data = this.nodes.get(id)?.get('data')
    if (!this.canWrite || !(data instanceof Y.Map)) return false
    this.doc.transact(() => {
      for (const [field, value] of Object.entries(patch)) {
        if (value === undefined) data.delete(field)
        else data.set(field, value)
      }
    }, UNTRACKED)
    return true
  }

  /**
   * New stacking orders for nodes the person added or restacked: siblings keep the order of
   * the canvas array. Nothing changes while the array still follows the orders this tab knows,
   * so a restack by someone else that has not been pulled yet is left alone.
   */
  private reorder(nodes: AppNode[], remote: Record<string, StoredNode>): Map<string, number> {
    const groups = new Map<string | undefined, string[]>()
    for (const node of nodes) {
      const siblings = groups.get(node.parentId)
      if (siblings) siblings.push(node.id)
      else groups.set(node.parentId, [node.id])
    }
    const sorted = (order: (id: string) => number | undefined) =>
      [...groups.values()].every((ids) =>
        ids.every((id, index) => {
          const [a, b] = [order(ids[index - 1]), order(id)]
          if (b === undefined) return false
          return index === 0 || (a !== undefined && (a < b || (a === b && ids[index - 1] < id)))
        }),
      )
    if (sorted((id) => remote[id]?.order)) {
      for (const node of nodes) this.seenOrder.set(node.id, remote[node.id].order)
      return new Map()
    }
    const known = (id: string) => this.seenOrder.get(id)
    const changed = new Map<string, number>()
    if (sorted(known)) return changed
    for (const ids of groups.values()) {
      let previous: number | undefined
      ids.forEach((id, index) => {
        let order = known(id)
        if (order === undefined || (previous !== undefined && order <= previous)) {
          const next = ids
            .slice(index + 1)
            .map(known)
            .find((later) => later !== undefined && (previous === undefined || later > previous))
          if (previous === undefined) order = next === undefined ? 0 : next - 1
          else order = next === undefined ? previous + 1 : (previous + next) / 2
          changed.set(id, order)
          this.seenOrder.set(id, order)
        }
        previous = order
      })
    }
    return changed
  }

  private writeNode(id: string, content: Content, before: Content | undefined, order: number) {
    const map = this.nodes.get(id)
    const data = map instanceof Y.Map ? map.get('data') : undefined
    if (!before || !(map instanceof Y.Map) || !(data instanceof Y.Map)) {
      const fresh = new Y.Map<unknown>()
      fresh.set('type', content.type)
      fresh.set('place', plain(content.place))
      fresh.set('size', plain(content.size))
      fresh.set('order', order)
      fresh.set('data', new Y.Map(Object.entries(plain(content.data))))
      this.nodes.set(id, fresh)
      return
    }
    if (map.get('order') !== order) map.set('order', order)
    for (const key of ['type', 'place', 'size'] as const) {
      if (canon(content[key]) !== canon(before[key])) map.set(key, plain(content[key]))
    }
    for (const field of new Set([...Object.keys(content.data), ...Object.keys(before.data)])) {
      const value = content.data[field]
      if (canon(value) === canon(before.data[field])) continue
      if (value === undefined) data.delete(field)
      else data.set(field, plain(value))
    }
  }
}

function same<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((item, index) => item === b[index])
}
