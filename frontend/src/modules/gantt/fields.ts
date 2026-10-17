import type { Row } from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'

// Mirror MAX_COLUMNS, MAX_VALUES and the value length in backend/app/domain/modules/gantt.py.
export const MAX_COLUMNS = 6
export const MAX_VALUES = 20
export const MAX_VALUE = 100
export const COLUMN_WIDTH = 88
// The "+" header that opens the column picker, kept even with no columns yet.
export const ADD_COLUMN_WIDTH = 28

/** Room the field columns take between the titles and the timeline; none with Planning off. */
// The block's own right border, between the last column and the timeline.
const COLUMNS_BORDER = 1

export function columnsWidth(content: GanttContent, planning: boolean) {
  if (!planning) return 0
  return (content.columns?.length ?? 0) * COLUMN_WIDTH + ADD_COLUMN_WIDTH + COLUMNS_BORDER
}

/** The row's own value, or the nearest ancestor's when it has none. */
export function cellValue(rows: Row[], row: Row, field: string) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  let at: Row | undefined = row
  while (at) {
    const value = at.values?.[field]
    if (value) return { value, own: at === row }
    at = at.parent ? byId.get(at.parent) : undefined
  }
  return { value: '', own: false }
}

/** Sets or clears one value; a row left without values loses the key, as older rows have. */
export function setValue(row: Row, field: string, text: string): Row {
  const { [field]: _old, ...rest } = row.values ?? {}
  const value = text.trim().slice(0, MAX_VALUE)
  const values = value ? { ...rest, [field]: value } : rest
  if (value && Object.keys(values).length > MAX_VALUES) return row
  const { values: _values, ...bare } = row
  return Object.keys(values).length ? { ...bare, values } : bare
}

/** Shows a field as the last column, or hides it; hiding keeps the values in the rows. */
export function toggleColumn(content: GanttContent, field: string): GanttContent {
  const columns = content.columns ?? []
  const next = columns.includes(field)
    ? columns.filter((id) => id !== field)
    : columns.length < MAX_COLUMNS
      ? [...columns, field]
      : columns
  const { columns: _columns, ...rest } = content
  return next.length ? { ...rest, columns: next } : rest
}
