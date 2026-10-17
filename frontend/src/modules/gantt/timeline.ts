/** Calendar days as whole numbers since 1970-01-01, so date math is integer math. */
export type Day = number

export type Scale = 'day' | 'week' | 'month' | 'quarter'

export type Cell = { label: string; from: number; span: number; weekend?: boolean }

const MS_PER_DAY = 86_400_000
export const MAX_RANGE_DAYS = 1096

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function parseDay(iso: string): Day {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / MS_PER_DAY
}

export function formatDay(day: Day): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
}

/** The browser's local calendar date: "today" is where the user is, not UTC. */
export function today(now = new Date()): Day {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY
}

function parts(day: Day) {
  const date = new Date(day * MS_PER_DAY)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), date: date.getUTCDate() }
}

const monthStart = (year: number, month: number): Day => Date.UTC(year, month, 1) / MS_PER_DAY

/** Monday is 0. */
function weekday(day: Day) {
  return (day + 3) % 7
}

function quarterIndex(day: Day) {
  const { year, month } = parts(day)
  return year * 4 + Math.floor(month / 3)
}

function quarterBounds(index: number) {
  const year = Math.floor(index / 4)
  const month = (index % 4) * 3
  return { start: monthStart(year, month), end: monthStart(year, month + 3) - 1 }
}

export function currentQuarter(day: Day) {
  return quarterBounds(quarterIndex(day))
}

/** One calendar quarter more before the quarter the range starts in. */
export function quarterBefore(start: Day): Day {
  return quarterBounds(quarterIndex(start) - 1).start
}

/** One calendar quarter more after the quarter the range ends in. */
export function quarterAfter(end: Day): Day {
  return quarterBounds(quarterIndex(end) + 1).end
}

export function rangeDays(start: Day, end: Day) {
  return end - start + 1
}

export function fitsRange(start: Day, end: Day) {
  return end >= start && end - start <= MAX_RANGE_DAYS
}

/** Splits [start, end] into cells that begin where next(day) says, clipped to the range. */
function cells(start: Day, end: Day, next: (day: Day) => Day, label: (day: Day) => string) {
  const out: Cell[] = []
  let from = start
  while (from <= end) {
    const to = Math.min(next(from), end + 1)
    out.push({ label: label(from), from: from - start, span: to - from })
    from = to
  }
  return out
}

const nextMonth = (day: Day) => {
  const { year, month } = parts(day)
  return monthStart(year, month + 1)
}
const nextQuarter = (day: Day) => quarterBounds(quarterIndex(day) + 1).start

const nextYear = (day: Day) => monthStart(parts(day).year + 1, 0)

const quarterLabel = (day: Day) => `Q${(quarterIndex(day) % 4) + 1} ${parts(day).year}`
const monthLabel = (day: Day) => `${MONTHS[parts(day).month]} ${parts(day).year}`

// "5–9": a week's first and last shown day; months sit in the row above.
const dayRange = (from: Day, to: Day) =>
  from === to ? String(parts(from).date) : `${parts(from).date}–${parts(to).date}`

/** Two header rows: a coarse one on top and the scale's own units below, in days from `start`. */
export function header(
  start: Day,
  end: Day,
  scale: Scale,
  working = false,
): { top: Cell[]; bottom: Cell[] } {
  if (scale === 'day') {
    return {
      top: cells(start, end, nextMonth, monthLabel),
      bottom: cells(
        start,
        end,
        (day) => day + 1,
        (day) => String(parts(day).date),
      ).map((cell) => ({ ...cell, weekend: weekday(start + cell.from) >= 5 })),
    }
  }
  if (scale === 'quarter') {
    return {
      top: cells(start, end, nextYear, (day) => String(parts(day).year)),
      bottom: cells(start, end, nextQuarter, (day) => `Q${(quarterIndex(day) % 4) + 1}`),
    }
  }
  if (scale === 'week') {
    // Months over weeks, the way plans are talked about: "October, the 5–9 week".
    const sunday = (day: Day) => day - weekday(day) + 6
    return {
      top: cells(start, end, nextMonth, monthLabel),
      bottom: cells(
        start,
        end,
        (day) => sunday(day) + 1,
        (day) => dayRange(day, Math.min(sunday(day) - (working ? 2 : 0), end)),
      ),
    }
  }
  return {
    top: cells(start, end, nextQuarter, quarterLabel),
    bottom: cells(start, end, nextMonth, (day) => MONTHS[parts(day).month]),
  }
}

export type Span = { start: Day; end: Day }

/**
 * The timeline's days in pixels. With working days only, Saturday and Sunday take no width
 * and every count runs over the days that are shown; days off stay shown but do not count.
 */
export type Axis = {
  range: Span
  px: number
  working: boolean
  off: ReadonlySet<Day>
  width: number
}

const mod = (n: number, m: number) => ((n % m) + m) % m

// Weekdays from Monday Dec 29, 1969 up to, not including, the day.
function weekdaysBefore(day: Day) {
  const n = day + 3
  return Math.floor(n / 7) * 5 + Math.min(mod(n, 7), 5)
}

function column(range: Span, working: boolean, day: Day) {
  return working ? weekdaysBefore(day) - weekdaysBefore(range.start) : day - range.start
}

function dayOfColumn(axis: Axis, col: number): Day {
  if (!axis.working) return axis.range.start + col
  const n = weekdaysBefore(axis.range.start) + col
  return Math.floor(n / 5) * 7 + mod(n, 5) - 3
}

export function makeAxis(
  range: Span,
  width: number,
  working = false,
  daysOff: string[] = [],
): Axis {
  const columns = Math.max(column(range, working, range.end + 1), 1)
  const px = width / columns
  return { range, px, working, off: new Set(working ? daysOff.map(parseDay) : []), width }
}

/** The left edge of a day; a hidden weekend sits where the next Monday starts. */
export function xOf(axis: Axis, day: Day) {
  return column(axis.range, axis.working, day) * axis.px
}

export function isWeekend(day: Day) {
  return weekday(day) >= 5
}

/** Where a bar sits in timeline pixels, clipped to the range; null when it is all outside. */
export function barBox(span: Span, axis: Axis) {
  const { range } = axis
  const from = Math.max(span.start, range.start)
  const to = Math.min(span.end, range.end)
  if (from > to) return null
  const left = xOf(axis, from)
  return {
    left,
    width: xOf(axis, to + 1) - left,
    clippedStart: span.start < range.start,
    clippedEnd: span.end > range.end,
  }
}

/** The shown day under a timeline x, kept inside the range. */
export function dayAt(x: number, axis: Axis): Day {
  const last = column(axis.range, axis.working, axis.range.end + 1) - 1
  const day = dayOfColumn(axis, Math.min(Math.max(Math.floor(x / axis.px), 0), Math.max(last, 0)))
  return Math.min(Math.max(day, axis.range.start), axis.range.end)
}

/** The day `steps` shown days after `day`. */
export function stepDays(axis: Axis, day: Day, steps: number): Day {
  return dayOfColumn(axis, column(axis.range, axis.working, day) + steps)
}

/** Days a span lasts; with working days only, weekends and days off are left out. */
export function countDays(axis: Axis, span: Span) {
  if (!axis.working) return rangeDays(span.start, span.end)
  let off = 0
  for (const day of axis.off) if (day >= span.start && day <= span.end && !isWeekend(day)) off++
  return weekdaysBefore(span.end + 1) - weekdaysBefore(span.start) - off
}

export type Grip = 'move' | 'start' | 'end'

/** A bar dragged by its body or one of its ends by whole days; it never ends before it starts. */
export function dragSpan(span: Span, grip: Grip, days: number): Span {
  if (grip === 'move') return { start: span.start + days, end: span.end + days }
  if (grip === 'start') return { start: Math.min(span.start + days, span.end), end: span.end }
  return { start: span.start, end: Math.max(span.end + days, span.start) }
}

/** `dragSpan` over the shown days, so a bar snaps to working days when weekends are hidden. */
export function dragOnAxis(axis: Axis, span: Span, grip: Grip, steps: number): Span {
  if (!axis.working || steps === 0) return dragSpan(span, grip, steps)
  const first = column(axis.range, true, span.start)
  const last = Math.max(column(axis.range, true, span.end + 1) - 1, first)
  const moved = dragSpan({ start: first, end: last }, grip, steps)
  const start = grip === 'end' ? span.start : dayOfColumn(axis, moved.start)
  const end = grip === 'start' ? span.end : dayOfColumn(axis, moved.end)
  return { start, end: Math.max(end, start) }
}

/** A new bar: a week from the given day, or from today when it is in range, else the range start. */
export function newSpan(range: Span, at?: Day, now = today()): Span {
  const start = at ?? (now >= range.start && now <= range.end ? now : range.start)
  return { start, end: start + 6 }
}

/** "Mon Oct 5", with the year when asked. */
export function formatDate(day: Day, year = false) {
  const { year: y, month, date } = parts(day)
  return `${WEEKDAYS[weekday(day)]} ${MONTHS[month]} ${date}${year ? `, ${y}` : ''}`
}

/** "Mon Oct 5 – Fri Oct 16 · 12 days"; years only when the span crosses one. */
export function formatSpan(span: Span, days = rangeDays(span.start, span.end)) {
  const length = `${days} ${days === 1 ? 'day' : 'days'}`
  if (span.start === span.end) return `${formatDate(span.start)} · ${length}`
  const years = parts(span.start).year !== parts(span.end).year
  return `${formatDate(span.start, years)} – ${formatDate(span.end, years)} · ${length}`
}
