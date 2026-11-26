import type { GanttContent } from '@/modules/gantt/schema'
import type { Span } from '@/modules/gantt/timeline'
import { shiftStages } from '@/modules/gantt/stages'
import { formatDay, parseDay } from '@/modules/gantt/timeline'

type Row = GanttContent['rows'][number]

export const MAX_DEPTH = 5

export type TreeRow = { row: Row; depth: number; hasChildren: boolean }

// Rows are kept in display order: every row's subtree follows it directly.

export function depths(rows: Row[]) {
  const out = new Map<string, number>()
  for (const row of rows) out.set(row.id, row.parent ? (out.get(row.parent) ?? 0) + 1 : 0)
  return out
}

/** Index just past the last descendant of rows[index]. */
export function subtreeEnd(rows: Row[], index: number) {
  const depth = depths(rows)
  const base = depth.get(rows[index].id)!
  let end = index + 1
  while (end < rows.length && depth.get(rows[end].id)! > base) end++
  return end
}

export function visibleRows(rows: Row[]): TreeRow[] {
  const depth = depths(rows)
  const out: TreeRow[] = []
  let hiddenBelow: number | null = null
  rows.forEach((row, i) => {
    const d = depth.get(row.id)!
    if (hiddenBelow !== null && d > hiddenBelow) return
    hiddenBelow = row.collapsed ? d : null
    out.push({ row, depth: d, hasChildren: rows[i + 1]?.parent === row.id })
  })
  return out
}

function union(rows: Row[]): Span | null {
  let span: Span | null = null
  for (const row of rows) {
    const start = parseDay(row.start)
    const end = parseDay(row.end)
    span = span
      ? { start: Math.min(span.start, start), end: Math.max(span.end, end) }
      : { start, end }
  }
  return span
}

/** What a row's bar covers: its own dates and everything under it. */
export function branchSpan(rows: Row[], index: number): Span {
  return union(rows.slice(index, subtreeEnd(rows, index)))!
}

/** What a row's children cover, or null without children. */
export function childrenSpan(rows: Row[], index: number): Span | null {
  return union(rows.slice(index + 1, subtreeEnd(rows, index)))
}

/** A parent stretched to new dates: it can grow past its children but never cut them off. */
export function resizeParent(content: GanttContent, id: string, next: Span): GanttContent {
  const index = content.rows.findIndex((r) => r.id === id)
  const inner = childrenSpan(content.rows, index)
  const start = inner ? Math.min(next.start, inner.start) : next.start
  const end = inner ? Math.max(next.end, inner.end) : next.end
  return {
    ...content,
    rows: content.rows.map((r) =>
      r.id === id ? { ...r, start: formatDay(start), end: formatDay(end) } : r,
    ),
  }
}

/** The ancestor ids of rows[index], nearest first, including the row itself. */
function chain(rows: Row[], index: number) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: string[] = []
  for (
    let row: Row | undefined = rows[index];
    row;
    row = row.parent ? byId.get(row.parent) : undefined
  ) {
    out.push(row.id)
  }
  return out
}

/**
 * Puts a block (a row and its subtree, in order) before `beforeId` (or at the end) with its top
 * at the asked depth, clamped to what keeps the tree valid. Null when it would go too deep.
 */
function insertBlock(rows: Row[], block: Row[], beforeId: string | null, depth: number) {
  const at = beforeId === null ? rows.length : rows.findIndex((r) => r.id === beforeId)
  const depth0 = depths(rows)
  const above = at > 0 ? chain(rows, at - 1) : []
  const next = rows[at]
  const min = next ? depth0.get(next.id)! : 0
  const max = above.length
  const top = Math.min(Math.max(depth, min), max)
  const blockDepth = depths(block)
  const deepest = Math.max(...block.map((r) => blockDepth.get(r.id)!))
  if (top + deepest >= MAX_DEPTH) return null
  // above is nearest-first: the parent at depth top - 1 sits (max - top) steps up.
  const parent = top === 0 ? undefined : above[max - top]
  const [head, ...rest] = block
  const placed = [{ ...head, parent }, ...rest]
  if (parent === undefined) delete placed[0].parent
  return [...rows.slice(0, at), ...placed, ...rows.slice(at)]
}

/** Moves a row with its subtree before another row, at a depth. */
export function moveSubtree(
  content: GanttContent,
  id: string,
  beforeId: string | null,
  depth: number,
): GanttContent {
  const from = content.rows.findIndex((r) => r.id === id)
  if (from < 0 || id === beforeId) return content
  const end = subtreeEnd(content.rows, from)
  const block = content.rows.slice(from, end)
  if (beforeId && block.some((r) => r.id === beforeId)) return content
  const rest = [...content.rows.slice(0, from), ...content.rows.slice(end)]
  const rows = insertBlock(rest, block, beforeId, depth)
  return rows ? { ...content, rows } : content
}

/** The rows to move: each picked row with its subtree, a row under a picked one riding along. */
export function movingRows(rows: Row[], ids: Iterable<string>) {
  const picked = new Set(ids)
  const depth = depths(rows)
  const moving = new Set<string>()
  const tops: string[] = []
  let inside = -1
  rows.forEach((row) => {
    const d = depth.get(row.id)!
    if (inside >= 0 && d > inside) return void moving.add(row.id)
    inside = -1
    if (!picked.has(row.id)) return
    tops.push(row.id)
    moving.add(row.id)
    inside = d
  })
  return { tops, moving }
}

/** How many levels the moving rows reach below their top rows. */
export function movingDepth(rows: Row[], ids: Iterable<string>) {
  const { tops, moving } = movingRows(rows, ids)
  const top = new Set(tops)
  const block = rows
    .filter((r) => moving.has(r.id))
    .map((r) => (top.has(r.id) ? { ...r, parent: undefined } : r))
  return Math.max(0, ...depths(block).values())
}

/**
 * Moves rows, each with its subtree, to sit right after `aboveId` (null: at the top) as siblings
 * at `depth`, in the order they had. Their parent is `aboveId` itself or one of its ancestors, so
 * a row never lands under a row hidden from view; a collapsed new parent opens. The same content
 * when nothing would change or the depth does not fit.
 */
export function moveRows(
  content: GanttContent,
  ids: Iterable<string>,
  aboveId: string | null,
  depth: number,
): GanttContent {
  const { tops, moving } = movingRows(content.rows, ids)
  if (tops.length === 0 || (aboveId && moving.has(aboveId))) return content
  const rest = content.rows.filter((r) => !moving.has(r.id))
  const block = content.rows.filter((r) => moving.has(r.id))
  const above = aboveId === null ? -1 : rest.findIndex((r) => r.id === aboveId)
  if (aboveId !== null && above < 0) return content
  const ancestors = above < 0 ? [] : chain(rest, above).reverse()
  const top = Math.min(Math.max(depth, 0), ancestors.length)
  if (top + movingDepth(content.rows, tops) >= MAX_DEPTH) return content
  // After the whole branch of the row above at this depth, so nothing of it is cut off.
  const anchor = ancestors[Math.min(top, ancestors.length - 1)]
  const at =
    anchor === undefined
      ? 0
      : subtreeEnd(
          rest,
          rest.findIndex((r) => r.id === anchor),
        )
  const parent = top === 0 ? undefined : ancestors[top - 1]
  const placed = block.map((r): Row => {
    if (!tops.includes(r.id)) return r
    const { parent: _old, ...free } = r
    return parent === undefined ? free : { ...free, parent }
  })
  const rows = [...rest.slice(0, at), ...placed, ...rest.slice(at)].map((r) =>
    r.id === parent && r.collapsed ? { ...r, collapsed: false } : r,
  )
  const was = content.rows
  const same = rows.every(
    (r, i) => r.id === was[i].id && r.parent === was[i].parent && r.collapsed === was[i].collapsed,
  )
  return same ? content : { ...content, rows }
}

/** Adds a row at a depth before another row (or at the end), as close to that depth as allowed. */
export function insertRow(content: GanttContent, row: Row, beforeId: string | null, depth: number) {
  const rows = insertBlock(content.rows, [row], beforeId, depth)
  return rows ? { ...content, rows } : null
}

export function indent(content: GanttContent, id: string) {
  const i = content.rows.findIndex((r) => r.id === id)
  const depth = depths(content.rows).get(id)!
  return moveSubtree(content, id, content.rows[subtreeEnd(content.rows, i)]?.id ?? null, depth + 1)
}

/** Moves the row up a level, placing it right after its old parent's subtree. */
export function outdent(content: GanttContent, id: string) {
  const row = content.rows.find((r) => r.id === id)
  if (!row?.parent) return content
  const parentIndex = content.rows.findIndex((r) => r.id === row.parent)
  const after = content.rows[subtreeEnd(content.rows, parentIndex)]?.id ?? null
  return moveSubtree(content, id, after, depths(content.rows).get(row.parent)!)
}

/** Adds a row as the last child of a parent and opens the parent so it shows. */
export function addChild(content: GanttContent, parentId: string, row: Row) {
  const i = content.rows.findIndex((r) => r.id === parentId)
  if (i < 0 || depths(content.rows).get(parentId)! + 1 >= MAX_DEPTH) return content
  const end = subtreeEnd(content.rows, i)
  const rows = [...content.rows]
  rows.splice(end, 0, { ...row, parent: parentId })
  rows[i] = { ...rows[i], collapsed: false }
  return { ...content, rows }
}

/** Removes a row; its children take its place in the tree, one level up. */
export function liftRemove(content: GanttContent, id: string): GanttContent {
  const row = content.rows.find((r) => r.id === id)
  if (!row) return content
  return {
    ...content,
    rows: content.rows
      .filter((r) => r.id !== id)
      .map((r) => {
        if (r.parent !== id) return r
        const { parent: _old, ...rest } = r
        return row.parent ? { ...rest, parent: row.parent } : rest
      }),
    links: content.links.filter((l) => l.from !== id && l.to !== id),
  }
}

/** Removes a row with everything under it, and the links that touch any of them. */
export function removeBranch(content: GanttContent, id: string): GanttContent {
  const from = content.rows.findIndex((r) => r.id === id)
  if (from < 0) return content
  const end = subtreeEnd(content.rows, from)
  const gone = new Set(content.rows.slice(from, end).map((r) => r.id))
  return {
    ...content,
    rows: content.rows.filter((r) => !gone.has(r.id)),
    links: content.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)),
  }
}

/** Moves a row and everything under it by whole days. */
export function shiftBranch(content: GanttContent, id: string, days: number): GanttContent {
  const from = content.rows.findIndex((r) => r.id === id)
  if (from < 0 || days === 0) return content
  const end = subtreeEnd(content.rows, from)
  const shift = (iso: string) => formatDay(parseDay(iso) + days)
  return {
    ...content,
    rows: content.rows.map((r, i) =>
      i >= from && i < end
        ? shiftStages({ ...r, start: shift(r.start), end: shift(r.end) }, days)
        : r,
    ),
  }
}

/** Folds or unfolds every row with children; the same content when nothing changes. */
export function foldAll(content: GanttContent, collapsed: boolean): GanttContent {
  const parents = new Set(content.rows.map((r) => r.parent))
  let changed = false
  const rows = content.rows.map((r) => {
    if (!parents.has(r.id) || Boolean(r.collapsed) === collapsed) return r
    changed = true
    return { ...r, collapsed }
  })
  return changed ? { ...content, rows } : content
}
