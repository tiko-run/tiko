import type { XYPosition } from '@xyflow/react'
import type { Peer } from '@/live/presence'

/** Where each node being dragged by someone else is right now, in board coordinates. */
export function remoteDrags(peers: Peer[]): Map<string, XYPosition> {
  const drags = new Map<string, XYPosition>()
  for (const peer of peers) {
    for (const [id, at] of Object.entries(peer.drag ?? {})) drags.set(id, at)
  }
  return drags
}

/**
 * The drags as they come in. A feed rather than state: each presence frame then wakes only what
 * draws the moves, not the whole canvas.
 */
export type DragFeed = {
  now(): ReadonlyMap<string, XYPosition>
  set(next: ReadonlyMap<string, XYPosition>): void
  listen(listener: () => void): () => void
}

export function dragFeed(): DragFeed {
  const listeners = new Set<() => void>()
  let drags: ReadonlyMap<string, XYPosition> = new Map()
  return {
    now: () => drags,
    set(next) {
      if (next === drags) return
      drags = next
      for (const listener of listeners) listener()
    },
    listen(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
