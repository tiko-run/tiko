const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const UNIT: Record<string, number> = { d: DAY, h: HOUR, m: MINUTE }
// A date without a time goes off at the start of a working day.
const DEFAULT_TIME: [number, number] = [10, 0]

const DURATION = /^(?:in )?((?:\d+ ?(?:d|h|min|m) ?)+|\d+)$/
const DURATION_PART = /(\d+) ?(d|h|min|m)/g
const CLOCK = /^(\d{1,2}):(\d{2})$/
const DOTTED = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2}))?$/
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const PRESETS = [
  { label: '15m', input: '15m' },
  { label: '30m', input: '30m' },
  { label: '1h', input: '1h' },
  { label: '2h', input: '2h' },
  { label: 'Tomorrow 10:00', input: 'tomorrow 10:00' },
]

export const WHEN_HINT = '30m, 2h, tomorrow 10:00, 25.10 15:00'

export type When = { at: number } | { error: string }

/** Reads a duration or a moment typed by the user; null for empty input. */
export function parseWhen(input: string, now: number): When | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!text) return null
  const at = parseDuration(text, now) ?? parseMoment(text, now)
  if (at === undefined) return { error: `Could not read this time. Try ${WHEN_HINT}.` }
  if (at <= now) return { error: 'This time has already passed.' }
  return { at }
}

function parseDuration(text: string, now: number) {
  const match = DURATION.exec(text)
  if (!match) return undefined
  // A bare number is minutes, the most common wait.
  if (/^\d+$/.test(match[1])) return now + Number(match[1]) * MINUTE
  let ms = 0
  for (const [, count, unit] of match[1].matchAll(DURATION_PART))
    ms += Number(count) * UNIT[unit[0]]
  return now + ms
}

function parseMoment(text: string, now: number) {
  const parts = text.split(' ')
  const clock = CLOCK.exec(parts.at(-1)!)
  if (clock) parts.pop()
  const [hours, minutes] = clock ? [Number(clock[1]), Number(clock[2])] : DEFAULT_TIME
  if (hours > 23 || minutes > 59) return undefined
  const day = parts.length ? parseDay(parts.join(' '), now) : { date: new Date(now), roll: 1 }
  if (!day) return undefined
  const at = new Date(day.date)
  at.setHours(hours, minutes, 0, 0)
  // A moment that has passed means its next occurrence: tomorrow, next week or next year.
  if (at.getTime() <= now && day.roll) {
    if (day.roll === 'year') at.setFullYear(at.getFullYear() + 1)
    else at.setDate(at.getDate() + day.roll)
  }
  return at.getTime()
}

type Day = { date: Date; roll?: number | 'year' }

function parseDay(text: string, now: number): Day | undefined {
  const today = new Date(now)
  if (text === 'today') return { date: today }
  if (text === 'tomorrow') return { date: shift(today, 1) }
  const weekday = WEEKDAYS.findIndex((name) => text.startsWith(name) && /^[a-z]+$/.test(text))
  if (weekday >= 0) return { date: shift(today, (weekday - today.getDay() + 7) % 7), roll: 7 }
  const dotted = DOTTED.exec(text)
  if (dotted) {
    const year = dotted[3] ? Number(dotted[3].padStart(4, '20')) : today.getFullYear()
    const date = calendar(year, Number(dotted[2]), Number(dotted[1]))
    return date && { date, roll: dotted[3] ? undefined : 'year' }
  }
  const iso = ISO_DATE.exec(text)
  if (iso) {
    const date = calendar(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return date && { date }
  }
  return undefined
}

function shift(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

// Date rolls 31.02 over to March; a typo should be an error instead.
function calendar(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day)
  return date.getMonth() === month - 1 && date.getDate() === day ? date : undefined
}

const DAY_WORDS = [
  'today',
  'tomorrow',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]
const SUGGESTIONS = 4
const CLOCKS = ['10:00', '14:00', '18:00']

const future = (input: string, now: number) => {
  const when = parseWhen(input, now)
  return when !== null && 'at' in when
}

export type Suggestion = { input: string; at: number }

/** Ways to finish what the user is typing, each one a time that reads and has not passed. */
export function suggestWhen(input: string, now: number): Suggestion[] {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^in /, '')
  if (!text) return []
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const candidate of candidates(text, now)) {
    if (out.length === SUGGESTIONS) break
    if (candidate === text || seen.has(candidate)) continue
    seen.add(candidate)
    const when = parseWhen(candidate, now)
    if (when && 'at' in when) out.push({ input: candidate, at: when.at })
  }
  return out
}

function candidates(text: string, now: number): string[] {
  // "3" → 3m, 3h, 3d; "9" also 9:00. A night hour is rarely meant, so 3:00 is left out.
  if (/^\d{1,3}$/.test(text)) {
    const clock = Number(text) >= 7 && Number(text) <= 23 ? [`${text}:00`] : []
    return [`${text}m`, `${text}h`, `${text}d`, ...clock]
  }
  // "1h 3" → 1h 3m: the next part of a duration, in a unit not used yet.
  const more = /^((?:\d+ ?(?:d|h|min|m) ?)+?) ?(\d+)$/.exec(text)
  if (more) {
    const used = new Set([...more[1].matchAll(DURATION_PART)].map(([, , unit]) => unit[0]))
    return ['m', 'h', 'd']
      .filter((unit) => !used.has(unit))
      .map((unit) => `${more[1].trim()} ${more[2]}${unit}`)
  }
  const [head, tail] = splitDay(text, now)
  if (head === undefined) {
    // "tu" → tue; "t" → today, tomorrow, tue, thu.
    if (!/^[a-z]+$/.test(text)) return dates(text, now)
    const words = DAY_WORDS.filter(
      (word) => word.startsWith(text) || text.startsWith(word.slice(0, 3)),
    )
    const days = words.map(short)
    if (days.length === 1) return CLOCKS.map((clock) => `${days[0]} ${clock}`)
    // One per day, at its first hour that has not passed: "today" at 11:00 is today 14:00.
    return days.flatMap(
      (day) => CLOCKS.map((clock) => `${day} ${clock}`).find((c) => future(c, now)) ?? [],
    )
  }
  const prefix = head ? `${head} ` : ''
  // "tue" plus a space, "tue 15" or "15:" → whole hours and the half.
  if (!tail) return CLOCKS.map((clock) => prefix + clock)
  const hour = /^(\d{1,2})(?::(\d?))?$/.exec(tail)
  if (!hour) return []
  const minutes =
    hour[2] === undefined || hour[2] === '' ? ['00', '30'] : [`${hour[2]}0`, `${hour[2]}5`]
  return minutes.map((m) => `${prefix}${hour[1]}:${m}`)
}

// Splits "tue 15" into the day and the start of a clock; a lone clock has an empty day.
function splitDay(text: string, now: number): [string | undefined, string] {
  if (/^\d{1,2}:\d?$/.test(text)) return ['', text]
  const space = text.indexOf(' ')
  const head = space < 0 ? text : text.slice(0, space)
  if (space < 0 && !DAY_WORDS.includes(head) && !WEEKDAYS.includes(head)) return [undefined, '']
  if (!parseDay(head, now)) return [undefined, '']
  return [short(head), space < 0 ? '' : text.slice(space + 1)]
}

// Only a weekday is shortened: "25.10" and "2026-10-25" stay whole.
const short = (day: string) => (WEEKDAYS.includes(day.slice(0, 3)) ? day.slice(0, 3) : day)

// "25." → the next two months that have a 25th still ahead; "25.1" → October, November, December, January.
function dates(text: string, now: number) {
  const partial = /^(\d{1,2})\.(\d{0,2})$/.exec(text)
  if (!partial) return []
  const start = new Date(now)
  const ahead = Array.from({ length: 12 }, (_, i) => {
    const month = new Date(start.getFullYear(), start.getMonth() + i, 1)
    const input = `${partial[1]}.${month.getMonth() + 1}`
    const when = parseWhen(input, now)
    // A day that has passed this month reads as next year; the same day next month comes first.
    const inMonth = when && 'at' in when && new Date(when.at).getFullYear() === month.getFullYear()
    return inMonth ? input : []
  }).flat()
  return partial[2]
    ? ahead.filter((input) => input.split('.')[1].startsWith(partial[2]))
    : ahead.slice(0, 2)
}

/** Time left in one short unit, for the cube: 45s, 28m, 3h, 2d. */
export function formatLeft(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

/** Time left in words: 45 s, 2 h 5 min, 1 d 3 h, 18 days. */
export function formatLeftLong(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 3 && hours % 24) return `${days} d ${hours % 24} h`
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n).padStart(2, '0')

// The UI is English whatever the browser locale; the time zone is the user's.
/** The moment as "Sun, 25.10.2026, 15:30". */
export function formatDue(at: number) {
  const d = new Date(at)
  const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
  return `${WEEKDAY_NAMES[d.getDay()]}, ${date}, ${formatClock(at)}`
}

/**
 * What a suggestion does not say itself: the clock and the day of a duration ("Tue 20.10, 15:30",
 * just "15:30" today), only the date of an input with a clock ("20.10", nothing today).
 */
export function suggestionNote({ input, at }: Suggestion, now: number) {
  const d = new Date(at)
  const today = d.toDateString() === new Date(now).toDateString()
  const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`
  if (input.includes(':')) return today ? '' : date
  return today ? formatClock(at) : `${WEEKDAY_NAMES[d.getDay()]} ${date}, ${formatClock(at)}`
}

/** Clock time only, 24-hour: "15:30". */
export function formatClock(at: number) {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
