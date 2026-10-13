import type { XYPosition } from '@xyflow/react'
import { absolute, framesFirst } from '@/canvas/frames'
import type { AppNode, TaskCardData, ModuleData } from '@/canvas/types'
import { findModule } from '@/modules/registry'

export const TIMER_SIZE = 40
const GAP = 6
// Dropped this close to its element, a timer stays attached where it was dropped.
const STAY = 48
const HOLDERS = new Set(['task_card', 'sticky', 'shape', 'text', 'module'])

// Left of the top edge: cards grow and collapse to the right and down, so this spot never moves.
export const BESIDE: XYPosition = { x: -(TIMER_SIZE + GAP), y: 0 }

export function holdsTimers(node: AppNode) {
  return HOLDERS.has(node.type ?? '')
}

/** The element a timer is attached to; a frame only contains it. */
export function holderOf(node: AppNode, byId: Map<string, AppNode>) {
  const parent = node.parentId ? byId.get(node.parentId) : undefined
  return parent && holdsTimers(parent) ? parent : undefined
}

function contains(node: AppNode, byId: Map<string, AppNode>, point: XYPosition, margin = 0) {
  const { x, y } = absolute(node, byId)
  const width = node.measured?.width ?? node.width ?? 0
  const height = node.measured?.height ?? node.height ?? 0
  return (
    point.x >= x - margin &&
    point.x <= x + width + margin &&
    point.y >= y - margin &&
    point.y <= y + height + margin
  )
}

/**
 * Dropped timers attach to the element under their center, stay on their element when dropped
 * near it, or come free; free ones are left for the frame rules.
 */
export function dropTimers(nodes: AppNode[], droppedIds: string[]): AppNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const dropped = new Set(droppedIds)
  let changed = false

  const next = nodes.map((node) => {
    if (node.type !== 'timer' || !dropped.has(node.id)) return node
    const position = absolute(node, byId)
    const center = { x: position.x + TIMER_SIZE / 2, y: position.y + TIMER_SIZE / 2 }
    const holder = holderOf(node, byId)
    const target = nodes.findLast((n) => holdsTimers(n) && contains(n, byId, center))
    if (target && target.id !== holder?.id) {
      changed = true
      return { ...node, parentId: target.id, position: BESIDE }
    }
    if (!holder || contains(holder, byId, center, STAY)) return node
    changed = true
    const { parentId: _old, ...rest } = node
    return { ...rest, position }
  })
  return changed ? framesFirst(next) : nodes
}

/** How a timer names its element: "DEMO-1", "a sticky note", a module's title. */
export function holderLabel(node: { type?: string; data: unknown }): string | undefined {
  switch (node.type) {
    case 'task_card':
      return (node.data as TaskCardData).key
    case 'sticky':
      return 'a sticky note'
    case 'shape':
      return 'a shape'
    case 'text':
      return 'a text'
    case 'module': {
      const { kind, title } = node.data as ModuleData
      return title || findModule(kind)?.name || 'a module'
    }
  }
  return undefined
}
