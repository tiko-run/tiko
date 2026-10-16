import { describe, expect, it } from 'vitest'
import type { Person } from '@/api/planning'
import type { GanttContent } from '@/modules/gantt/schema'
import { awayDuring, awayLine, laneHeight, LANE_ROW, timeOffLane } from '@/modules/gantt/timeoff'
import { parseDay } from '@/modules/gantt/timeline'
import type { PlanningState } from '@/planning/context'

const person = (id: string, name: string, off: [string, string][] = []): Person => ({
  id,
  name,
  teams: [],
  source: 'manual',
  archived: false,
  off: off.map(([start, end], i) => ({ id: `${id}-o${i}`, start, end })),
})

const anna = person('p1', 'Anna', [['2026-10-05', '2026-10-09']])
const ivan = person('p2', 'Ivan', [['2026-10-08', '2026-10-14']])
const oleg = person('p3', 'Oleg', [['2026-10-12', '2026-10-16']])

const gantt = (people: string[]): GanttContent => ({
  start: '2026-10-01',
  end: '2026-12-31',
  scale: 'week',
  labelWidth: 160,
  rows: [
    {
      id: 'r1',
      title: 'Checkout UI',
      start: '2026-10-05',
      end: '2026-10-16',
      stages: [{ id: 's1', type: 't1', start: '2026-10-05', end: '2026-10-16', people }],
    },
  ],
  milestones: [],
  links: [],
})
const range = { start: parseDay('2026-10-01'), end: parseDay('2026-12-31') }
const planning = (people: Person[], enabled = true): PlanningState => ({
  enabled,
  types: [],
  people,
})
const span = (start: string, end: string) => ({ start: parseDay(start), end: parseDay(end) })

describe('Time off lane', () => {
  it('is empty when nobody with a stage here is away', () => {
    expect(timeOffLane(gantt(['p9']), planning([anna]), range).lanes).toBe(0)
    expect(timeOffLane(gantt(['p1']), planning([{ ...anna, off: [] }]), range).lanes).toBe(0)
    expect(laneHeight(0)).toBe(0)
  })

  it('is empty with Planning off', () => {
    expect(timeOffLane(gantt(['p1']), planning([anna], false), range).lanes).toBe(0)
  })

  it('leaves out time off outside the range', () => {
    const later = { ...range, start: parseDay('2026-11-01') }
    expect(timeOffLane(gantt(['p1']), planning([anna]), later).lanes).toBe(0)
  })

  it('stacks overlapping ranges and reuses a lane once it is free', () => {
    const lane = timeOffLane(gantt(['p1', 'p2', 'p3']), planning([anna, ivan, oleg]), range)
    expect(lane.items.map((item) => [item.person.name, item.lane])).toEqual([
      ['Anna', 0],
      ['Ivan', 1],
      ['Oleg', 0],
    ])
    expect(lane.lanes).toBe(2)
    expect(laneHeight(lane.lanes)).toBeGreaterThan(2 * LANE_ROW)
  })
})

describe('away during a stage', () => {
  it('finds time off on any day of the stage, edges included', () => {
    const people = [anna, ivan]
    expect(awayDuring(span('2026-10-09', '2026-10-09'), ['p1'], people)).toHaveLength(1)
    expect(awayDuring(span('2026-10-10', '2026-10-11'), ['p1'], people)).toHaveLength(0)
    expect(awayDuring(span('2026-10-01', '2026-10-04'), ['p1'], people)).toHaveLength(0)
    const both = awayDuring(span('2026-10-08', '2026-10-08'), ['p1', 'p2'], people)
    expect(both.map(awayLine)).toEqual([
      'Anna is away Mon Oct 5 – Fri Oct 9',
      'Ivan is away Thu Oct 8 – Wed Oct 14',
    ])
  })

  it('reads the same list for every Gantt, so two boards see one conflict', () => {
    const shared = planning([anna])
    const other: GanttContent = {
      ...gantt([]),
      rows: [
        {
          id: 'x1',
          title: 'Partner onboarding',
          start: '2026-10-07',
          end: '2026-10-08',
          stages: [{ id: 'x', type: 't4', start: '2026-10-07', end: '2026-10-08', people: ['p1'] }],
        },
      ],
    }
    for (const board of [gantt(['p1']), other]) {
      expect(timeOffLane(board, shared, range).lanes).toBe(1)
      const stage = board.rows[0].stages![0]
      const away = awayDuring(span(stage.start, stage.end), stage.people, shared.people)
      expect(away.map(awayLine)).toEqual(['Anna is away Mon Oct 5 – Fri Oct 9'])
    }
  })

  it('goes once the time off is removed', () => {
    const stage = span('2026-10-06', '2026-10-07')
    expect(awayDuring(stage, ['p1'], [{ ...anna, off: [] }])).toEqual([])
  })

  it('names a single day once', () => {
    const away = awayDuring(
      span('2026-10-05', '2026-10-05'),
      ['p1'],
      [person('p1', 'Anna', [['2026-10-05', '2026-10-05']])],
    )
    expect(away.map(awayLine)).toEqual(['Anna is away Mon Oct 5'])
  })

  it('ignores ids the directory does not know', () => {
    expect(awayDuring(span('2026-10-05', '2026-10-09'), ['nope'], [anna])).toEqual([])
  })
})
