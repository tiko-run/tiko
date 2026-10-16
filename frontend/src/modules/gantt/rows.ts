import type { XYPosition } from '@xyflow/react'
import type { TaskLink } from '@/canvas/tasks-context'
import { columnsWidth } from '@/modules/gantt/fields'
import type { GanttContent } from '@/modules/gantt/schema'
import { dayAt, formatDay, newSpan, parseDay, rangeDays, type Span } from '@/modules/gantt/timeline'
import { laneHeight, timeOffLane } from '@/modules/gantt/timeoff'
import { insertRow, visibleRows } from '@/modules/gantt/tree'
import type { PlanningState } from '@/planning/context'
import { newId } from '@/lib/id'

export type Row = GanttContent['rows'][number]

export const LABEL_WIDTH = { min: 120, max: 480 }
export const HEADER_ROW = 24
export const HEADER = HEADER_ROW * 2
export const ROW_HEIGHT = 32
// Names in a line under each stage, like the spreadsheet the plan came from.
export const ROW_HEIGHT_BELOW = 48
export const FOOTER = 40
export const MAX_ROWS = 200

export function range(content: GanttContent): Span {
  return { start: parseDay(content.start), end: parseDay(content.end) }
}

/** Where the timeline starts: after the titles and, with Planning on, the field columns. */
export function timelineLeft(content: GanttContent, planning: boolean) {
  return content.labelWidth + columnsWidth(content, planning)
}

export function pxPerDay(content: GanttContent, width: number, planning: boolean) {
  const { start, end } = range(content)
  return Math.max(width - timelineLeft(content, planning), 1) / rangeDays(start, end)
}

export function rowHeight(content: GanttContent, planning: boolean) {
  return planning && content.people === 'below' ? ROW_HEIGHT_BELOW : ROW_HEIGHT
}

/** Where the first row starts: under the header and, when someone is away, the Time off lane. */
export function rowsTop(content: GanttContent, planning: PlanningState) {
  return HEADER + laneHeight(timeOffLane(content, planning, range(content)).lanes)
}

/** Body height that shows every visible row, keeping one empty row as a drop target. */
export function bodyHeight(content: GanttContent, planning: PlanningState) {
  const rows = Math.max(visibleRows(content.rows).length, 1)
  return rowsTop(content, planning) + rows * rowHeight(content, planning.enabled) + FOOTER
}

export function spanOf(row: Row): Span {
  return { start: parseDay(row.start), end: parseDay(row.end) }
}

export function withSpan(row: Row, span: Span): Row {
  return { ...row, start: formatDay(span.start), end: formatDay(span.end) }
}

/** The task a row plans; undefined for a plain row. */
export function rowTask(row: Row): TaskLink | undefined {
  if (!row.key) return undefined
  return { key: row.key, ...(row.source && { source: row.source }) }
}

// A row saved before trackers could be mixed names none and stands for the instance's own,
// so it counts as planned whichever tracker the same key comes with.
function planned(content: GanttContent, task: TaskLink) {
  return content.rows.some(
    (r) => r.key === task.key && (!r.source || !task.source || r.source === task.source),
  )
}

export function makeRow(
  content: GanttContent,
  fields: { key?: string; source?: string; title?: string },
  at?: number,
) {
  const span = newSpan(range(content), at)
  return withSpan({ id: newId(), title: '', ...fields, start: '', end: '' }, span)
}

/** Adds rows at the end, skipping tasks already planned here, up to the row limit. */
export function addRows(content: GanttContent, rows: Row[]): GanttContent {
  let next = content
  for (const row of rows) {
    const task = rowTask(row)
    // Checked against the rows added so far, so one task is not added twice in one go.
    if (!task || !planned(next, task)) next = { ...next, rows: [...next.rows, row] }
  }
  return { ...next, rows: next.rows.slice(0, MAX_ROWS) }
}

export function updateRow(content: GanttContent, id: string, change: (row: Row) => Row) {
  return { ...content, rows: content.rows.map((r) => (r.id === id ? change(r) : r)) }
}

/** A card dropped on the body becomes a row at the drop day and between the rows it fell on. */
export function acceptCard(
  content: GanttContent,
  task: TaskLink,
  at: XYPosition,
  width: number,
  planning: PlanningState,
): GanttContent | null {
  if (content.rows.length >= MAX_ROWS || planned(content, task)) return null
  const left = timelineLeft(content, planning.enabled)
  const day =
    at.x >= left
      ? dayAt(at.x - left, range(content), pxPerDay(content, width, planning.enabled))
      : undefined
  // Between the visible rows it fell on, next to the row above it.
  const visible = visibleRows(content.rows)
  const slot = Math.min(
    Math.max(
      Math.round((at.y - rowsTop(content, planning)) / rowHeight(content, planning.enabled)),
      0,
    ),
    visible.length,
  )
  const before = visible[slot]?.row.id ?? null
  return insertRow(content, makeRow(content, task, day), before, visible[slot - 1]?.depth ?? 0)
}
