import { describe, expect, it } from 'vitest'
import {
  acceptCard,
  addRows,
  bodyHeight,
  HEADER,
  MAX_ROWS,
  ROW_HEIGHT,
  type Row,
} from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'

const row = (id: string, key?: string): Row => ({
  id,
  ...(key && { key }),
  title: '',
  start: '2026-10-05',
  end: '2026-10-09',
})

const base: GanttContent = {
  start: '2026-10-01',
  end: '2026-10-31',
  scale: 'week',
  labelWidth: 160,
  rows: [row('a', 'DEMO-1'), row('b')],
  milestones: [],
  links: [{ id: 'l', from: 'a', to: 'b' }],
}
// 31 days over 310px of timeline: 10px a day.
const WIDTH = base.labelWidth + 310

describe('rows', () => {
  it('skips tasks already on the chart and stops at the limit', () => {
    expect(addRows(base, [row('c', 'DEMO-1'), row('d', 'DEMO-2')]).rows.map((r) => r.id)).toEqual([
      'a',
      'b',
      'd',
    ])
    const full = { ...base, rows: Array.from({ length: MAX_ROWS }, (_, i) => row(String(i))) }
    expect(addRows(full, [row('x')]).rows).toHaveLength(MAX_ROWS)
  })

  it('grows with rows and keeps one empty row', () => {
    expect(bodyHeight({ ...base, rows: [] }, false)).toBe(
      bodyHeight({ ...base, rows: [row('a')] }, false),
    )
    expect(bodyHeight(base, false) - bodyHeight({ ...base, rows: [row('a')] }, false)).toBe(
      ROW_HEIGHT,
    )
  })
})

describe('card drop', () => {
  it('becomes a row at the drop day, between the rows it fell on', () => {
    const at = { x: base.labelWidth + 95, y: HEADER + ROW_HEIGHT }
    const next = acceptCard(base, { key: 'DEMO-7' }, at, WIDTH, false)!
    expect(next.rows.map((r) => r.key ?? r.id)).toEqual(['DEMO-1', 'DEMO-7', 'b'])
    expect(next.rows[1]).toMatchObject({ start: '2026-10-10', end: '2026-10-16' })
  })

  it('is refused for a task already on the chart', () => {
    expect(acceptCard(base, { key: 'DEMO-1' }, { x: 300, y: 60 }, WIDTH, false)).toBeNull()
  })

  it('is refused for a task an older row plans without naming its tracker', () => {
    const card = { key: 'DEMO-1', source: 'jira' }
    expect(acceptCard(base, card, { x: 300, y: 60 }, WIDTH, false)).toBeNull()
    expect(addRows(base, [{ ...row('c', 'DEMO-1'), source: 'jira' }]).rows).toHaveLength(2)
  })

  it('takes the same key from another tracker next to a row that names its own', () => {
    const named = { ...base, rows: [{ ...row('a', 'DEMO-1'), source: 'jira' }] }
    const next = acceptCard(
      named,
      { key: 'DEMO-1', source: 'demo' },
      { x: 300, y: 60 },
      WIDTH,
      false,
    )
    expect(next?.rows.map((r) => r.source).sort()).toEqual(['demo', 'jira'])
  })
})
