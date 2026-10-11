import type { TaskLink } from '@/canvas/tasks-context'
import type { AppNode } from '@/canvas/types'
import { findModule } from '@/modules/registry'

// A node's data object stays the same while the node is only moved, so a drag never parses
// a module's content again.
const cache = new WeakMap<object, TaskLink[]>()

/** The live tasks a node holds: a card's own, or the ones inside a module. */
export function nodeTasks(node: AppNode): TaskLink[] {
  if (node.type === 'task_card') return [node.data]
  if (node.type !== 'module') return []
  const cached = cache.get(node.data)
  if (cached) return cached
  const def = findModule(node.data.kind)
  const parsed = def?.schema.safeParse(node.data.content)
  const tasks = def && parsed?.success ? def.keys(parsed.data) : []
  cache.set(node.data, tasks)
  return tasks
}

/** Whether the board holds tasks of two or more trackers. */
export function hasMixedSources(nodes: AppNode[], defaultSource: string) {
  let first: string | undefined
  for (const node of nodes) {
    for (const task of nodeTasks(node)) {
      const source = task.source || defaultSource
      first ??= source
      if (source !== first) return true
    }
  }
  return false
}
