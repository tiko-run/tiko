import { describe, expect, it } from 'vitest'
import {
  ADD_COLUMN_WIDTH,
  cellValue,
  COLUMN_WIDTH,
  columnsWidth,
  MAX_COLUMNS,
  setValue,
  toggleColumn,
} from '@/modules/gantt/fields'
import type { Row } from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'

const row = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  title: id,
  start: '2026-10-05',
  end: '2026-10-09',
  ...extra,
})

const rows = [
  row('epic', { values: { f7: 'Q4', priority: '1' } }),
  row('child', { parent: 'epic' }),
  row('grandchild', { parent: 'child' }),
  row('own', { parent: 'epic', values: { f7: 'Q1' } }),
  row('alone'),
]
const at = (id: string) => rows.find((r) => r.id === id)!

const content: GanttContent = {
  start: '2026-10-01',
  end: '2026-12-31',
  scale: 'week',
  labelWidth: 160,
  rows,
  milestones: [],
  links: [],
}

describe('cell values', () => {
  it('come from the nearest ancestor when the row has none', () => {
    expect(cellValue(rows, at('epic'), 'f7')).toEqual({ value: 'Q4', own: true })
    expect(cellValue(rows, at('child'), 'f7')).toEqual({ value: 'Q4', own: false })
    expect(cellValue(rows, at('grandchild'), 'priority')).toEqual({ value: '1', own: false })
  })

  it('are overridden by the row and its children', () => {
    expect(cellValue(rows, at('own'), 'f7')).toEqual({ value: 'Q1', own: true })
    const under = row('under', { parent: 'own' })
    expect(cellValue([...rows, under], under, 'f7')).toEqual({ value: 'Q1', own: false })
  })

  it('are empty without any ancestor value', () => {
    expect(cellValue(rows, at('alone'), 'f7')).toEqual({ value: '', own: false })
  })
})

describe('setting a value', () => {
  it('trims and stores it', () => {
    expect(setValue(at('alone'), 'f7', '  Q2 ').values).toEqual({ f7: 'Q2' })
  })

  it('clears it to inherit again, dropping an empty map', () => {
    const cleared = setValue(at('own'), 'f7', '   ')
    expect(cleared).not.toHaveProperty('values')
    expect(cellValue([...rows.filter((r) => r.id !== 'own'), cleared], cleared, 'f7').value).toBe(
      'Q4',
    )
  })

  it('keeps the other fields of the row', () => {
    expect(setValue(at('epic'), 'f7', '').values).toEqual({ priority: '1' })
  })

  it('cuts a long value to 100 characters', () => {
    expect(setValue(at('alone'), 'f7', 'x'.repeat(150)).values!.f7).toHaveLength(100)
  })
})

describe('columns', () => {
  it('toggle on at the end and off again, keeping the values', () => {
    const shown = toggleColumn(toggleColumn(content, 'priority'), 'f7')
    expect(shown.columns).toEqual(['priority', 'f7'])
    const hidden = toggleColumn(toggleColumn(shown, 'priority'), 'f7')
    expect(hidden).not.toHaveProperty('columns')
    expect(hidden.rows).toBe(rows)
  })

  it(`stop at ${MAX_COLUMNS}`, () => {
    const full = { ...content, columns: ['a', 'b', 'c', 'd', 'e', 'f'] }
    expect(toggleColumn(full, 'g').columns).toEqual(full.columns)
  })

  it('take room only with Planning on', () => {
    const two = { ...content, columns: ['priority', 'f7'] }
    expect(columnsWidth(two, false)).toBe(0)
    expect(columnsWidth(two, true)).toBe(2 * COLUMN_WIDTH + ADD_COLUMN_WIDTH + 1)
  })

  it('name the same field on two Gantts, each with its own values', () => {
    const other = { ...content, rows: [row('x', { values: { f7: 'Q3' } })], columns: ['f7'] }
    const mine = toggleColumn(content, 'f7')
    expect(mine.columns).toEqual(other.columns)
    expect(cellValue(other.rows, other.rows[0], 'f7').value).toBe('Q3')
    expect(cellValue(mine.rows, at('child'), 'f7').value).toBe('Q4')
  })
})
