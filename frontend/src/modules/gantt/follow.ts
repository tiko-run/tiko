import type { Task } from '@/api/tasks'
import type { Row } from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'
import { fitStages } from '@/modules/gantt/stages'
import { formatDate, parseDay, type Span } from '@/modules/gantt/timeline'

// A side the tracker has no date for is drawn a week from the other, like a new bar.
export const GUESS_DAYS = 6

/** The side of a bar the tracker has no date for. */
export type Guess = 'start' | 'end'
export type Tracked = { span: Span; guess?: Guess }

/** The dates the tracker holds for a task, a missing side filled in; null when it has none. */
export function trackerSpan(task: Task | undefined): Tracked | null {
  if (!task || task.state !== 'ok') return null
  const start = task.start ? parseDay(task.start) : null
  const due = task.due ? parseDay(task.due) : null
  if (start !== null && due !== null) return { span: { start, end: due } }
  if (due !== null) return { span: { start: due - GUESS_DAYS, end: due }, guess: 'start' }
  if (start !== null) return { span: { start, end: start + GUESS_DAYS }, guess: 'end' }
  return null
}

function parentIds(content: GanttContent) {
  return new Set(content.rows.flatMap((r) => r.parent ?? []))
}

// A leaf spans its stages: stages may keep a bar from reaching the tracker's dates exactly.
function spanned(row: Row): Row {
  const stages = row.stages
  if (!stages?.length) return row
  return { ...row, start: stages[0].start, end: stages[stages.length - 1].end }
}

const same = (a: Row, b: Row) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Whether a row draws its task's dates. A parent spans its children, and a row cut into stages
 * keeps the plan people made of them: both show the tracker's dates beside their own instead.
 */
export function follows(row: Row, parent: boolean) {
  return Boolean(row.follow) && !parent && !row.stages?.length
}

/** Moves every following leaf onto its task's dates; the same object when nothing moves. */
export function followTracker(
  content: GanttContent,
  taskOf: (row: Row) => Task | undefined,
): GanttContent {
  const parents = parentIds(content)
  let changed = false
  const rows = content.rows.map((row) => {
    const tracked = follows(row, parents.has(row.id)) ? trackerSpan(taskOf(row)) : null
    if (!tracked) return row
    const next = spanned(fitStages(row, tracked.span))
    if (same(next, row)) return row
    changed = true
    return next
  })
  return changed ? { ...content, rows } : content
}

/**
 * Takes off the tracker every following leaf whose dates a person changed: their dates are
 * now their own. Rows whose task has no dates keep following, for when it gets some.
 */
export function detachEdited(
  before: GanttContent,
  after: GanttContent,
  taskOf: (row: Row) => Task | undefined,
): { content: GanttContent; detached: string[] } {
  const was = new Map(before.rows.map((r) => [r.id, r]))
  const parents = parentIds(after)
  const detached: string[] = []
  const rows = after.rows.map((row) => {
    // A row cut into stages stops following quietly: its bar did not move.
    if (row.follow && row.stages?.length) return withFollow(row, false)
    const old = was.get(row.id)
    if (!row.follow || !old || parents.has(row.id)) return row
    if (row.start === old.start && row.end === old.end) return row
    if (!trackerSpan(taskOf(row))) return row
    detached.push(row.id)
    return withFollow(row, false)
  })
  const changed = rows.some((row, i) => row !== after.rows[i])
  return { content: changed ? { ...after, rows } : after, detached }
}

/** A row that follows the tracker, or keeps its own dates; the key is left out when it does not. */
export function withFollow(row: Row, follow: boolean): Row {
  const { follow: _old, ...rest } = row
  return follow ? { ...rest, follow: true } : rest
}

/**
 * Where a row's own dates and its task's disagree, for the mark at the end of its bar. A side
 * the tracker has no date for is not compared.
 */
export function drift(task: Task | undefined, shown: Span): Tracked | null {
  const tracked = trackerSpan(task)
  if (!tracked) return null
  const start = tracked.guess !== 'start' && tracked.span.start !== shown.start
  const end = tracked.guess !== 'end' && tracked.span.end !== shown.end
  return start || end ? tracked : null
}

/** The tracker's own dates in words; a side it has none for is left out. */
export function trackerDates({ span, guess }: Tracked) {
  if (guess === 'start') return `Due ${formatDate(span.end)}`
  if (guess === 'end') return `Starts ${formatDate(span.start)}`
  return `${formatDate(span.start)} – ${formatDate(span.end)}`
}
