import { describe, expect, it } from 'vitest'
import type { Person } from '@/api/planning'
import {
  activeFilters,
  filterOptions,
  MAX_FILTER_VALUES,
  parts,
  sameFilters,
  shownRows,
  toggleFilter,
} from '@/modules/gantt/filters'
import type { Row } from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'
import type { PlanningState } from '@/planning/context'

const person = (id: string, name: string, teams: string[]): Person => ({
  id,
  name,
  teams,
  source: 'manual',
  archived: false,
  off: [],
})
const stage = (people: string[]) => ({
  id: `s-${people.join('-')}`,
  type: 't1',
  start: '2026-10-05',
  end: '2026-10-09',
  people,
})
const row = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  title: id,
  start: '2026-10-05',
  end: '2026-10-09',
  ...extra,
})

const planning: PlanningState = {
  enabled: true,
  types: [],
  people: [person('mia', 'Mia', ['Web']), person('ivan', 'Ivan', ['Core'])],
  fields: [],
  views: [],
  daysOff: [],
}
// The scenario of the spec: Quarter Q4 and Team Web keep "Partner onboarding" for Mia's stage.
const rows = [
  row('redesign', { values: { f7: 'Q4', team: 'Web' } }),
  row('checkout', { parent: 'redesign' }),
  row('payment', { parent: 'redesign', values: { f7: 'Q1' } }),
  row('partner', { values: { f7: 'Q4, Q1', team: 'Core' }, stages: [stage(['mia'])] }),
  row('backup', { values: { f7: 'Q4', team: 'Core' }, stages: [stage(['ivan'])] }),
]
const gantt = (filters?: GanttContent['filters'], extra: Partial<GanttContent> = {}) =>
  ({
    start: '2026-10-01',
    end: '2026-12-31',
    scale: 'week',
    labelWidth: 160,
    rows,
    milestones: [],
    links: [],
    ...(filters && { filters }),
    ...extra,
  }) as GanttContent
const ids = (content: GanttContent, state = planning) =>
  shownRows(content, state).map(({ row }) => row.id)

describe('shownRows', () => {
  it('shows every row without filters or with Planning off', () => {
    expect(ids(gantt())).toHaveLength(5)
    expect(ids(gantt({ f7: ['Q1'] }), { ...planning, enabled: false })).toHaveLength(5)
  })

  it('matches inherited values and keeps the parents of a match', () => {
    expect(ids(gantt({ f7: ['Q4'] }))).toEqual(['redesign', 'checkout', 'partner', 'backup'])
  })

  it('matches each part of a comma-separated value', () => {
    expect(ids(gantt({ f7: ['Q1'] }))).toEqual(['redesign', 'payment', 'partner'])
  })

  it('values of one field match any, different fields must all match', () => {
    expect(ids(gantt({ team: ['Web', 'Core'] }))).toHaveLength(5)
    expect(ids(gantt({ f7: ['Q4'], team: ['Web'] }))).toEqual(['redesign', 'checkout', 'partner'])
  })

  it('a team takes part through a person of that team on a stage', () => {
    expect(ids(gantt({ team: ['Web'] }))).toEqual(['redesign', 'checkout', 'payment', 'partner'])
  })

  it('filters by person on a stage', () => {
    expect(ids(gantt({ person: ['ivan'] }))).toEqual(['backup'])
  })

  it('keeps a collapsed parent of a match closed', () => {
    const closed = rows.map((r) => (r.id === 'redesign' ? { ...r, collapsed: true } : r))
    expect(ids(gantt({ f7: ['Q1'] }, { rows: closed }))).toEqual(['redesign', 'partner'])
  })

  it('shows nothing when nothing matches', () => {
    expect(ids(gantt({ f7: ['Q3'] }))).toEqual([])
  })
})

describe('filter editing', () => {
  it('toggles values and drops an emptied filter', () => {
    const one = toggleFilter(gantt(), 'f7', 'Q4')
    expect(one.filters).toEqual({ f7: ['Q4'] })
    const two = toggleFilter(one, 'f7', 'Q1')
    expect(two.filters).toEqual({ f7: ['Q4', 'Q1'] })
    expect(toggleFilter(toggleFilter(two, 'f7', 'Q4'), 'f7', 'Q1')).not.toHaveProperty('filters')
  })

  it('stops at the value limit', () => {
    let content = gantt()
    for (let i = 0; i <= MAX_FILTER_VALUES; i++) content = toggleFilter(content, 'f7', `v${i}`)
    expect(content.filters?.f7).toHaveLength(MAX_FILTER_VALUES)
  })

  it('compares filter sets in any order', () => {
    expect(sameFilters({ a: ['1', '2'], b: ['x'] }, { b: ['x'], a: ['2', '1'] })).toBe(true)
    expect(sameFilters({ a: ['1'] }, { a: ['1'], b: ['x'] })).toBe(false)
    expect(sameFilters({}, {})).toBe(true)
  })

  it('is off with Planning off or no filters', () => {
    expect(activeFilters(gantt({ f7: ['Q4'] }), false)).toBeNull()
    expect(activeFilters(gantt(), true)).toBeNull()
  })
})

describe('filterOptions', () => {
  it('lists the parts typed in this Gantt', () => {
    expect(filterOptions(gantt(), planning, 'f7').map((o) => o.value)).toEqual(['Q1', 'Q4'])
  })

  it('adds the teams of people to Team', () => {
    const teams = filterOptions(gantt(), planning, 'team').map((o) => o.value)
    expect(teams).toEqual(['Core', 'Web'])
  })

  it('lists people with a stage here, by name', () => {
    expect(filterOptions(gantt(), planning, 'person')).toEqual([
      { value: 'ivan', label: 'Ivan' },
      { value: 'mia', label: 'Mia' },
    ])
  })

  it('keeps a chosen value even when no row has it any more', () => {
    expect(filterOptions(gantt({ f7: ['Q3'] }), planning, 'f7').map((o) => o.value)).toContain('Q3')
  })
})

it('splits a value into trimmed parts', () => {
  expect(parts(' Q4 ,Q1,, ')).toEqual(['Q4', 'Q1'])
})
