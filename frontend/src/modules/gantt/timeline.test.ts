import { describe, expect, it } from 'vitest'
import {
  barBox,
  countDays,
  currentQuarter,
  dayAt,
  dragOnAxis,
  dragSpan,
  fitsRange,
  formatDay,
  formatSpan,
  header,
  makeAxis,
  newSpan,
  parseDay,
  quarterAfter,
  quarterBefore,
  rangeDays,
  stepDays,
  today,
  xOf,
} from '@/modules/gantt/timeline'

const d = parseDay

describe('days', () => {
  it('round-trips ISO dates', () => {
    expect(formatDay(d('2026-10-06'))).toBe('2026-10-06')
    expect(d('2026-10-07') - d('2026-10-06')).toBe(1)
  })

  it('takes today from the local calendar date', () => {
    expect(formatDay(today(new Date(2026, 9, 6, 23, 59)))).toBe('2026-10-06')
  })
})

describe('quarters', () => {
  it('finds the current quarter', () => {
    const q = currentQuarter(d('2026-11-15'))
    expect([formatDay(q.start), formatDay(q.end)]).toEqual(['2026-10-01', '2026-12-31'])
  })

  it('adds a calendar quarter on either side', () => {
    expect(formatDay(quarterBefore(d('2026-10-01')))).toBe('2026-07-01')
    expect(formatDay(quarterBefore(d('2026-01-20')))).toBe('2025-10-01')
    expect(formatDay(quarterAfter(d('2026-12-31')))).toBe('2027-03-31')
    expect(formatDay(quarterAfter(d('2026-08-10')))).toBe('2026-12-31')
  })

  it('limits the range to about 3 years', () => {
    expect(fitsRange(d('2026-01-01'), d('2028-12-31'))).toBe(true)
    expect(fitsRange(d('2026-01-01'), d('2029-04-01'))).toBe(false)
    expect(fitsRange(d('2026-01-02'), d('2026-01-01'))).toBe(false)
  })
})

describe('header', () => {
  const start = d('2026-09-28')
  const end = d('2026-12-31')

  it('covers the range without gaps at every scale', () => {
    for (const scale of ['day', 'week', 'month', 'quarter'] as const) {
      const { top, bottom } = header(start, end, scale)
      for (const row of [top, bottom]) {
        expect(row[0].from).toBe(0)
        expect(row.reduce((sum, cell) => sum + cell.span, 0)).toBe(rangeDays(start, end))
      }
    }
  })

  it('shows months over weeks, clipping the first week to the range', () => {
    const { top, bottom } = header(d('2026-09-30'), end, 'week')
    expect(top.map((c) => c.label)).toEqual([
      'September 2026',
      'October 2026',
      'November 2026',
      'December 2026',
    ])
    expect(top[0].span).toBe(1)
    expect(bottom[0]).toEqual({ label: '30–4', from: 0, span: 5 })
    expect(bottom[1].label).toBe('5–11')
  })

  it('names a week by its working days when weekends are hidden', () => {
    const { bottom } = header(d('2026-10-05'), d('2026-10-31'), 'week', true)
    expect(bottom.map((c) => c.label)).toEqual(['5–9', '12–16', '19–23', '26–30'])
  })

  it('shows months over days and marks weekends', () => {
    const { top, bottom } = header(start, d('2026-10-04'), 'day')
    expect(top.map((c) => c.label)).toEqual(['September 2026', 'October 2026'])
    expect(bottom.map((c) => c.label)).toEqual(['28', '29', '30', '1', '2', '3', '4'])
    expect(bottom.map((c) => Boolean(c.weekend))).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ])
  })

  it('shows years over quarters', () => {
    const { top, bottom } = header(d('2026-10-01'), d('2027-06-30'), 'quarter')
    expect(top.map((c) => c.label)).toEqual(['2026', '2027'])
    expect(bottom.map((c) => c.label)).toEqual(['Q4', 'Q1', 'Q2'])
  })

  it('shows quarters over months', () => {
    const { bottom } = header(start, end, 'month')
    expect(bottom.map((c) => c.label)).toEqual(['Sep', 'Oct', 'Nov', 'Dec'])
  })
})

describe('bars', () => {
  const range = { start: d('2026-10-01'), end: d('2026-10-31') }
  const axis = makeAxis(range, 310)

  it('places a bar by its days, end day included', () => {
    expect(barBox({ start: d('2026-10-03'), end: d('2026-10-04') }, axis)).toEqual({
      left: 20,
      width: 20,
      clippedStart: false,
      clippedEnd: false,
    })
  })

  it('clips a bar at the range edges and hides one fully outside', () => {
    const box = barBox({ start: d('2026-09-20'), end: d('2026-10-02') }, axis)
    expect(box).toMatchObject({ left: 0, width: 20, clippedStart: true })
    expect(barBox({ start: d('2026-11-02'), end: d('2026-11-05') }, axis)).toBeNull()
  })

  it('maps x to a day inside the range', () => {
    expect(formatDay(dayAt(25, axis))).toBe('2026-10-03')
    expect(formatDay(dayAt(-40, axis))).toBe('2026-10-01')
    expect(formatDay(dayAt(9999, axis))).toBe('2026-10-31')
  })

  it('moves and stretches by whole days without inverting', () => {
    const span = { start: 10, end: 14 }
    expect(dragSpan(span, 'move', -3)).toEqual({ start: 7, end: 11 })
    expect(dragSpan(span, 'start', 2)).toEqual({ start: 12, end: 14 })
    expect(dragSpan(span, 'start', 9)).toEqual({ start: 14, end: 14 })
    expect(dragSpan(span, 'end', -9)).toEqual({ start: 10, end: 10 })
  })

  it('starts a new bar today when today is in range', () => {
    expect(newSpan(range, undefined, d('2026-10-06'))).toEqual({
      start: d('2026-10-06'),
      end: d('2026-10-12'),
    })
    expect(newSpan(range, undefined, d('2027-01-06')).start).toBe(range.start)
    expect(newSpan(range, d('2026-10-20')).start).toBe(d('2026-10-20'))
  })
})

it('a span reads as weekdays, dates and its length', () => {
  const span = (a: string, b: string) => ({ start: parseDay(a), end: parseDay(b) })
  expect(formatSpan(span('2026-10-05', '2026-10-16'))).toBe('Mon Oct 5 – Fri Oct 16 · 12 days')
  expect(formatSpan(span('2026-10-05', '2026-10-05'))).toBe('Mon Oct 5 · 1 day')
  expect(formatSpan(span('2026-12-28', '2027-01-08'))).toBe(
    'Mon Dec 28, 2026 – Fri Jan 8, 2027 · 12 days',
  )
})

describe('working days', () => {
  // Thu Oct 1 to Sat Oct 31: 22 weekdays, Nov 4 is outside, Oct 14 is a day off.
  const range = { start: d('2026-10-01'), end: d('2026-10-31') }
  const axis = makeAxis(range, 220, true, ['2026-10-14', '2026-11-04'])

  it('gives weekends no width', () => {
    expect(axis.px).toBe(10)
    expect(xOf(axis, d('2026-10-02'))).toBe(10)
    expect(xOf(axis, d('2026-10-03'))).toBe(20)
    expect(xOf(axis, d('2026-10-05'))).toBe(20)
    expect(barBox({ start: d('2026-10-02'), end: d('2026-10-05') }, axis)).toMatchObject({
      left: 10,
      width: 20,
    })
  })

  it('draws a weekend-only bar with no width, for the caller to widen', () => {
    expect(barBox({ start: d('2026-10-03'), end: d('2026-10-04') }, axis)?.width).toBe(0)
  })

  it('maps x to shown days only', () => {
    expect(formatDay(dayAt(25, axis))).toBe('2026-10-05')
    expect(formatDay(dayAt(9999, axis))).toBe('2026-10-30')
  })

  it('snaps a dragged bar to working days and keeps its working length', () => {
    const span = { start: d('2026-10-05'), end: d('2026-10-09') }
    const moved = dragOnAxis(axis, span, 'move', 3)
    expect([formatDay(moved.start), formatDay(moved.end)]).toEqual(['2026-10-08', '2026-10-14'])
    const stretched = dragOnAxis(axis, span, 'end', 1)
    expect(formatDay(stretched.end)).toBe('2026-10-12')
    expect(dragOnAxis(axis, span, 'start', 0)).toEqual(span)
  })

  it('steps over weekends', () => {
    expect(formatDay(stepDays(axis, d('2026-10-05'), 4))).toBe('2026-10-09')
    expect(formatDay(stepDays(axis, d('2026-10-09'), 1))).toBe('2026-10-12')
  })

  it('counts neither weekends nor days off', () => {
    expect(countDays(axis, { start: d('2026-10-12'), end: d('2026-10-16') })).toBe(4)
    expect(countDays(axis, { start: d('2026-10-05'), end: d('2026-10-11') })).toBe(5)
    expect(countDays(makeAxis(range, 310), { start: d('2026-10-05'), end: d('2026-10-11') })).toBe(
      7,
    )
  })
})
