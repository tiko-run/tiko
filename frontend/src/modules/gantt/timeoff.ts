import type { Person, TimeOff } from '@/api/planning'
import type { GanttContent } from '@/modules/gantt/schema'
import { formatDate, parseDay, type Span } from '@/modules/gantt/timeline'
import type { PlanningState } from '@/planning/context'

export type Away = { person: Person; off: TimeOff; span: Span }
export type PlacedAway = Away & { lane: number }

export const LANE_ROW = 24
// Room above the first range and below the last one.
const LANE_PAD = 8

const overlaps = (a: Span, b: Span) => a.start <= b.end && a.end >= b.start

function awayOf(person: Person): Away[] {
  return person.off.map((off) => ({
    person,
    off,
    span: { start: parseDay(off.start), end: parseDay(off.end) },
  }))
}

/** Time off of a stage's people that falls on any of its days. */
export function awayDuring(span: Span, ids: string[], people: Person[]): Away[] {
  const byId = new Map(people.map((p) => [p.id, p]))
  return ids.flatMap((id) => {
    const person = byId.get(id)
    return person ? awayOf(person).filter((away) => overlaps(away.span, span)) : []
  })
}

/** "Mon Oct 5 – Fri Oct 9", or one day. */
export function offDates(off: TimeOff) {
  const start = parseDay(off.start)
  const end = parseDay(off.end)
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`
}

/** "Anna is away Mon Oct 5 – Fri Oct 9". */
export function awayLine({ person, off }: Away) {
  return `${person.name} is away ${offDates(off)}`
}

/**
 * Time off of everyone with a stage in this Gantt, inside its range; overlapping ranges stack
 * on lanes of their own. No lanes means the Gantt shows no Time off lane at all.
 */
export function timeOffLane(content: GanttContent, planning: PlanningState, range: Span) {
  if (!planning.enabled) return { items: [] as PlacedAway[], lanes: 0 }
  const staged = new Set(content.rows.flatMap((r) => r.stages ?? []).flatMap((s) => s.people))
  const shown = planning.people
    .filter((p) => staged.has(p.id))
    .flatMap(awayOf)
    .filter((away) => overlaps(away.span, range))
    .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end)
  const ends: number[] = []
  const items = shown.map((away) => {
    let lane = ends.findIndex((end) => end < away.span.start)
    if (lane < 0) lane = ends.push(0) - 1
    ends[lane] = away.span.end
    return { ...away, lane }
  })
  return { items, lanes: ends.length }
}

export function laneHeight(lanes: number) {
  return lanes > 0 ? lanes * LANE_ROW + LANE_PAD : 0
}
