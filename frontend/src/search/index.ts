import type { Task } from '@/api/tasks'
import { taskRef } from '@/canvas/tasks-context'
import type { AppNode, FrameData, ModuleData } from '@/canvas/types'
import { findModule } from '@/modules/registry'
import { holderLabel } from '@/timers/attach'
import { normalize, rank, type Searchable } from './match'
import { compileFilters, FIELDS, passes, type Facets, type Filter } from './query'

export type EntryKind =
  'card' | 'sticky' | 'text' | 'frame' | 'timer' | 'module' | 'row' | 'milestone'

export type Entry = Searchable & {
  /** Unique per entry; a module's rows share the module's node. */
  id: string
  kind: EntryKind
  /** The node the board moves to. */
  target: string
  /** Task key shown in monospace before the text. */
  label?: string
  text: string
  /** Where it lives: frame, module, attached element, card status. */
  context?: string
  /** Task type for the card icon. */
  typeName?: string
  /** Module kind for the module icon. */
  module?: string
  /** Task fields that filters look at, as shown and normalized. */
  facets?: Facets
  facetKeys?: Facets
  order: number
}

type NewEntry = Omit<Entry, 'haystack' | 'head' | 'order' | 'key'> & {
  /** More searched text that is not shown: status, assignee, type, priority. */
  extra?: string[]
}

const UNTITLED_FRAME = 'Untitled frame'

function join(...parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(' · ')
}

// Fields of a live task that are searched and filtered by but not shown in the row.
function taskFacets(task: Task | undefined) {
  if (task?.state !== 'ok') return {}
  const facets: Facets = {
    assignee: task.assignee_name ?? undefined,
    status: task.status_name,
    type: task.type_name,
    priority: task.priority_name ?? undefined,
  }
  const facetKeys: Facets = Object.fromEntries(
    FIELDS.flatMap((field) => (facets[field] ? [[field, normalize(facets[field])]] : [])),
  )
  return { facets, facetKeys, extra: FIELDS.map((field) => facets[field] ?? '') }
}

/** Every searchable text of the board, in board order. */
export function buildIndex(nodes: AppNode[], tasks: Record<string, Task>): Entry[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const frameOf = (node: AppNode): string | undefined => {
    for (
      let up = node.parentId && byId.get(node.parentId);
      up;
      up = up.parentId && byId.get(up.parentId)
    ) {
      if (up.type === 'frame') return `in ${(up.data as FrameData).title || UNTITLED_FRAME}`
    }
    return undefined
  }
  const entries: Entry[] = []
  const push = (entry: NewEntry) => {
    const { extra = [], ...rest } = entry
    entries.push({
      ...rest,
      haystack: normalize([entry.label, entry.text, ...extra].filter(Boolean).join('\n')),
      head: normalize(entry.text),
      key: entry.label && normalize(entry.label),
      order: entries.length,
    })
  }

  for (const node of nodes) {
    const base = { id: node.id, target: node.id }
    switch (node.type) {
      case 'sticky':
      case 'text':
        if (node.data.text.trim()) {
          push({ ...base, kind: node.type, text: node.data.text, context: frameOf(node) })
        }
        break
      case 'frame':
        push({ ...base, kind: 'frame', text: node.data.title || UNTITLED_FRAME })
        break
      case 'task_card': {
        const task = tasks[taskRef(node.data)]
        const live = task?.state === 'ok' ? task : undefined
        push({
          ...base,
          kind: 'card',
          label: node.data.key,
          text: task && !live ? 'Not found' : (live?.summary ?? ''),
          context: join(live?.status_name, live?.assignee_name, frameOf(node)),
          typeName: live?.type_name,
          ...taskFacets(task),
        })
        break
      }
      case 'timer': {
        const holder = node.parentId ? byId.get(node.parentId) : undefined
        const on = holder && holderLabel(holder)
        if (node.data.note.trim()) {
          push({
            ...base,
            kind: 'timer',
            text: node.data.note,
            context: on ? `on ${on}` : frameOf(node),
          })
        }
        break
      }
      case 'module':
        pushModule(node.id, node.data, frameOf(node), tasks, push)
        break
    }
  }
  return entries
}

function pushModule(
  id: string,
  data: ModuleData,
  frame: string | undefined,
  tasks: Record<string, Task>,
  push: (entry: NewEntry) => void,
) {
  const def = findModule(data.kind)
  const name = data.title || def?.name || 'Module'
  push({
    id,
    target: id,
    kind: 'module',
    module: data.kind,
    text: name,
    context: frame,
    extra: [def?.name ?? ''],
  })
  const parsed = def?.searchable && def.schema.safeParse(data.content)
  if (!def?.searchable || !parsed?.success) return
  def.searchable(parsed.data).forEach((item, i) => {
    const task = item.key ? tasks[taskRef({ key: item.key, source: item.source })] : undefined
    const text = task?.state === 'ok' ? task.summary : item.text
    if (!text.trim() && !item.key) return
    push({
      id: `${id}:${i}`,
      target: id,
      kind: item.kind,
      label: item.key,
      text,
      context: `in ${name}`,
      typeName: task?.type_name,
      ...taskFacets(task),
    })
  })
}

export type Scope = { filters?: Filter[]; framesOnly?: boolean }

export type Results = {
  entries: Entry[]
  total: number
  /** Nodes of every match, not only the shown ones, without repeats. */
  targets: string[]
}

/** Matching entries, best first, at most `limit` of them. */
export function search(
  index: Entry[],
  query: string[],
  { filters = [], framesOnly = false }: Scope = {},
  limit = 50,
): Results {
  const compiled = compileFilters(filters)
  const hits: { entry: Entry; rank: number }[] = []
  for (const entry of index) {
    if (framesOnly && entry.kind !== 'frame' && entry.kind !== 'module') continue
    if (!passes(entry.facetKeys, compiled)) continue
    const r = rank(entry, query)
    if (r >= 0) hits.push({ entry, rank: r })
  }
  hits.sort((a, b) => a.rank - b.rank || a.entry.order - b.entry.order)
  return {
    entries: hits.slice(0, limit).map((hit) => hit.entry),
    total: hits.length,
    targets: [...new Set(hits.map((hit) => hit.entry.target))],
  }
}
