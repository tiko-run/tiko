import { absolute, detach } from '@/canvas/frames'
import type { AppNode } from '@/canvas/types'
import { findModule } from '@/modules/registry'

/** Height of a module's own header; module coordinates start below it. */
export const MODULE_HEADER = 36

function size(node: AppNode) {
  return {
    width: node.measured?.width ?? node.width ?? 0,
    height: node.measured?.height ?? node.height ?? 0,
  }
}

/**
 * Dropped cards whose center lands on a module that takes cards become part of that module.
 * Returns the absorbed card ids, or null when nothing changed.
 */
export function absorbCards(nodes: AppNode[], droppedIds: string[], planning: boolean) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const dropped = new Set(droppedIds)
  const absorbed = new Set<string>()
  const contents = new Map<string, unknown>()

  for (const card of nodes) {
    if (card.type !== 'task_card' || !dropped.has(card.id)) continue
    const position = absolute(card, byId)
    const box = size(card)
    const center = { x: position.x + box.width / 2, y: position.y + box.height / 2 }
    const target = nodes.findLast((m) => {
      if (m.type !== 'module') return false
      const { width, height } = size(m)
      return (
        center.x >= m.position.x &&
        center.x <= m.position.x + width &&
        center.y >= m.position.y + MODULE_HEADER &&
        center.y <= m.position.y + height
      )
    })
    if (target?.type !== 'module') continue
    const def = findModule(target.data.kind)
    const parsed = def?.schema.safeParse(contents.get(target.id) ?? target.data.content)
    if (!def?.acceptCard || !parsed?.success) continue
    const at = { x: center.x - target.position.x, y: center.y - target.position.y - MODULE_HEADER }
    const next = def.acceptCard(parsed.data, card.data, at, size(target).width, planning)
    if (next === null) continue
    contents.set(target.id, next)
    absorbed.add(card.id)
  }

  if (absorbed.size === 0) return null
  return {
    absorbed,
    nodes: nodes
      .filter((n) => !absorbed.has(n.id))
      .map((n) =>
        n.type === 'module' && contents.has(n.id)
          ? { ...n, data: { ...n.data, content: contents.get(n.id) } }
          : n.parentId && absorbed.has(n.parentId)
            ? detach(n, byId)
            : n,
      ),
  }
}
