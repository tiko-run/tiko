import type { StageType } from '@/api/planning'
import type { Row } from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'
import { formatDay, parseDay, type Day, type Grip, type Span } from '@/modules/gantt/timeline'
import { newId } from '@/lib/id'

export type Stage = NonNullable<Row['stages']>[number]

export const MAX_STAGES = 20
/** The bar of a row without stages, drawn as a stage without a type until it gets one. */
export const BARE = 'bare'

export const stageSpan = (stage: Stage): Span => ({
  start: parseDay(stage.start),
  end: parseDay(stage.end),
})

/** What a row draws in Planning: its stages, or its own bar as one stage without a type. */
export function shownStages(row: Row): Stage[] {
  if (row.stages?.length) return row.stages
  return [{ id: BARE, type: '', start: row.start, end: row.end, people: [] }]
}

/** Stages sorted, with the row's dates following their span; none leaves the row's dates. */
export function withStages(row: Row, stages: Stage[]): Row {
  if (stages.length === 0) {
    const { stages: _gone, ...rest } = row
    return rest
  }
  const sorted = [...stages].sort((a, b) => a.start.localeCompare(b.start))
  return { ...row, stages: sorted, start: sorted[0].start, end: sorted[sorted.length - 1].end }
}

// A stage made from the bare bar gets a real id the first time it changes.
const real = (stages: Stage[]) =>
  stages.map((stage) => (stage.id === BARE ? { ...stage, id: newId() } : stage))

/** The free days around a day that no stage covers, or null when one covers it. */
export function gapAt(row: Row, day: Day): Span | null {
  let start = -Infinity
  let end = Infinity
  for (const stage of shownStages(row)) {
    const span = stageSpan(stage)
    if (day >= span.start && day <= span.end) return null
    if (span.end < day) start = Math.max(start, span.end + 1)
    if (span.start > day) end = Math.min(end, span.start - 1)
  }
  return { start, end }
}

/** A stage dragged by its body or an end, stopped by its neighbours. */
export function clampStage(row: Row, id: string, next: Span, grip: Grip): Span {
  const stages = shownStages(row)
  const own = stageSpan(stages.find((s) => s.id === id)!)
  let lo = -Infinity
  let hi = Infinity
  for (const stage of stages) {
    if (stage.id === id) continue
    const span = stageSpan(stage)
    if (span.end < own.start) lo = Math.max(lo, span.end + 1)
    if (span.start > own.end) hi = Math.min(hi, span.start - 1)
  }
  if (grip === 'move') {
    const length = own.end - own.start
    const start = Math.min(Math.max(next.start, lo), hi - length)
    return { start, end: start + length }
  }
  if (grip === 'start') return { start: Math.min(Math.max(next.start, lo), own.end), end: own.end }
  return { start: own.start, end: Math.max(Math.min(next.end, hi), own.start) }
}

/** The type after the previous stage's, skipping a pause; the first one starts the list. */
export function nextType(types: StageType[], row: Row, start: Day): string {
  const active = types.filter((t) => !t.archived)
  if (active.length === 0) return ''
  // A pause is not a phase of the work: a new stage neither lands on it nor counts from it.
  const work = active.filter((t) => t.name.toLowerCase() !== 'on hold')
  const order = work.length ? work : active
  const before = shownStages(row)
    .filter((s) => parseDay(s.end) < start && order.some((t) => t.id === s.type))
    .sort((a, b) => b.end.localeCompare(a.end))[0]
  if (!before) return order[0].id
  const at = order.findIndex((t) => t.id === before.type)
  return order[Math.min(at + 1, order.length - 1)].id
}

export function addStage(row: Row, span: Span, type: string): { row: Row; id: string } | null {
  const stages = shownStages(row)
  if (stages.length >= MAX_STAGES) return null
  const stage = {
    id: newId(),
    type,
    start: formatDay(span.start),
    end: formatDay(span.end),
    people: [],
  }
  return { row: withStages(row, [...real(stages), stage]), id: stage.id }
}

/** Changes one stage; the bare bar becomes a real stage on its first change. */
export function updateStage(row: Row, id: string, change: Partial<Omit<Stage, 'id'>>): Row {
  return withStages(row, real(shownStages(row).map((s) => (s.id === id ? { ...s, ...change } : s))))
}

export function setStageSpan(row: Row, id: string, span: Span): Row {
  return updateStage(row, id, { start: formatDay(span.start), end: formatDay(span.end) })
}

/** Removes a stage; the last one leaves the row a plain bar with the same dates. */
export function removeStage(row: Row, id: string): Row {
  return withStages(
    row,
    (row.stages ?? []).filter((s) => s.id !== id),
  )
}

const shift = (iso: string, days: number) => formatDay(parseDay(iso) + days)

export function shiftStages(row: Row, days: number): Row {
  if (!row.stages?.length || days === 0) return row
  return {
    ...row,
    stages: row.stages.map((s) => ({ ...s, start: shift(s.start, days), end: shift(s.end, days) })),
  }
}

/**
 * A stage dragged with `push` by its body or end to the right pushes the later stages of its
 * row by the same days, gaps kept. Otherwise, leftwards or by its start it stops at its neighbours.
 */
export function dragStage(row: Row, id: string, next: Span, grip: Grip, push: boolean): Row {
  const own = stageSpan(shownStages(row).find((s) => s.id === id)!)
  const days = next.end - own.end
  if (!push || grip === 'start' || days <= 0) {
    return setStageSpan(row, id, clampStage(row, id, next, grip))
  }
  const start = grip === 'move' ? next.start : own.start
  const moved = shownStages(row).map((s) => {
    if (s.id === id) return { ...s, start: formatDay(start), end: formatDay(next.end) }
    if (parseDay(s.start) <= own.end) return s
    return { ...s, start: shift(s.start, days), end: shift(s.end, days) }
  })
  return withStages(row, real(moved))
}

/**
 * The row's bar dragged with Planning off: moving takes every stage along, an end stretches
 * the first or the last stage, never past its own other end.
 */
export function fitStages(row: Row, next: Span): Row {
  const dated = { ...row, start: formatDay(next.start), end: formatDay(next.end) }
  const stages = row.stages
  if (!stages?.length) return dated
  const days = next.start - parseDay(row.start)
  if (next.end - next.start === parseDay(row.end) - parseDay(row.start)) {
    return shiftStages(dated, days)
  }
  const first = stages[0]
  const last = stages[stages.length - 1]
  const start = Math.min(next.start, parseDay(first.end))
  const end = Math.max(next.end, parseDay(last.start))
  const changed = stages.map((s, i) => ({
    ...s,
    ...(i === 0 && { start: formatDay(start) }),
    ...(i === stages.length - 1 && { end: formatDay(end) }),
  }))
  return withStages(row, changed)
}

/**
 * Leaves follow their stages. A row that stops being a parent may have been stretched past
 * them, and the server refuses a leaf whose dates differ from its stages.
 */
export function fitLeaves(content: GanttContent): GanttContent {
  const parents = new Set(content.rows.map((r) => r.parent))
  let changed = false
  const rows = content.rows.map((row) => {
    const stages = row.stages
    if (!stages?.length || parents.has(row.id)) return row
    const start = stages[0].start
    const end = stages[stages.length - 1].end
    if (row.start === start && row.end === end) return row
    changed = true
    return { ...row, start, end }
  })
  return changed ? { ...content, rows } : content
}
