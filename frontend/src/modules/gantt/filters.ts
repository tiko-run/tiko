import type { Filters } from '@/api/planning'
import type { Row } from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'
import { visibleRows, type TreeRow } from '@/modules/gantt/tree'
import type { PlanningState } from '@/planning/context'

// Mirror MAX_FILTERS and MAX_FILTER_VALUES in backend/app/domain/modules/gantt.py.
export const MAX_FILTERS = 20
export const MAX_FILTER_VALUES = 20
export const PERSON = 'person'
export const TEAM = 'team'
// The strip of views and filter chips above the Gantt, shown with Planning on.
export const FILTER_BAR = 36

/** "Q4, Q1" holds two values; each one matches on its own. */
export function parts(value: string) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

/** The filters in effect: none with Planning off, so the Gantt shows every row as before. */
export function activeFilters(content: GanttContent, planning: boolean): Filters | null {
  const filters = planning ? content.filters : undefined
  return filters && Object.keys(filters).length ? filters : null
}

function inherited(byId: Map<string, Row>, row: Row, field: string) {
  for (let at: Row | undefined = row; at; at = at.parent ? byId.get(at.parent) : undefined) {
    const value = at.values?.[field]
    if (value) return value
  }
  return ''
}

/** One field's values match any of them, different fields must all match. */
function leafMatches(row: Row, filters: Filters, byId: Map<string, Row>, planning: PlanningState) {
  const people = (row.stages ?? []).flatMap((stage) => stage.people)
  return Object.entries(filters).every(([key, wanted]) => {
    if (key === PERSON) return people.some((id) => wanted.includes(id))
    if (parts(inherited(byId, row, key)).some((part) => wanted.includes(part))) return true
    // A team takes part where one of its people has a stage, whatever the row's own team.
    if (key !== TEAM) return false
    const teams = new Set(planning.people.flatMap((p) => (people.includes(p.id) ? p.teams : [])))
    return wanted.some((team) => teams.has(team))
  })
}

/** Rows to draw: the open ones that match the filters, with the parents of every match. */
export function shownRows(content: GanttContent, planning: PlanningState): TreeRow[] {
  const all = visibleRows(content.rows)
  const filters = activeFilters(content, planning.enabled)
  if (!filters) return all
  const byId = new Map(content.rows.map((r) => [r.id, r]))
  const keep = new Set<string>()
  content.rows.forEach((row, i) => {
    const leaf = content.rows[i + 1]?.parent !== row.id
    if (!leaf || !leafMatches(row, filters, byId, planning)) return
    for (let at: Row | undefined = row; at && !keep.has(at.id);) {
      keep.add(at.id)
      at = at.parent ? byId.get(at.parent) : undefined
    }
  })
  return all.filter(({ row }) => keep.has(row.id))
}

/** What a filter on `key` can pick: values typed in this Gantt, teams of people, people on stages. */
export function filterOptions(
  content: GanttContent,
  planning: PlanningState,
  key: string,
): { value: string; label: string }[] {
  const chosen = content.filters?.[key] ?? []
  if (key === PERSON) {
    const used = new Set([...content.rows.flatMap((r) => r.stages ?? []).flatMap((s) => s.people)])
    return planning.people
      .filter((p) => used.has(p.id) || chosen.includes(p.id))
      .map((p) => ({ value: p.id, label: p.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }
  const values = new Set(chosen)
  for (const row of content.rows) parts(row.values?.[key] ?? '').forEach((v) => values.add(v))
  if (key === TEAM) planning.people.forEach((p) => p.teams.forEach((t) => values.add(t)))
  return [...values].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }))
}

/** Picks or drops one value; a filter left without values goes, as does an empty set. */
export function toggleFilter(content: GanttContent, key: string, value: string): GanttContent {
  const current = content.filters?.[key] ?? []
  const values = current.includes(value)
    ? current.filter((v) => v !== value)
    : current.length < MAX_FILTER_VALUES
      ? [...current, value]
      : current
  const { [key]: _old, ...rest } = content.filters ?? {}
  const next = values.length ? { ...rest, [key]: values } : rest
  if (Object.keys(next).length > MAX_FILTERS) return content
  return withFilters(content, next)
}

export function withFilters(content: GanttContent, filters: Filters): GanttContent {
  const { filters: _filters, ...rest } = content
  return Object.keys(filters).length ? { ...rest, filters } : rest
}

/** Same keys with the same values, in any order: the view the Gantt shows now. */
export function sameFilters(a: Filters, b: Filters) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => {
    const x = a[key]
    const y = b[key] ?? []
    return x.length === y.length && x.every((v) => y.includes(v))
  })
}
