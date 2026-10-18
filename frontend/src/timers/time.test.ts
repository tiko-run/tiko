import { describe, expect, it } from 'vitest'
import {
  formatDue,
  formatLeft,
  formatLeftLong,
  parseWhen,
  suggestionNote,
  suggestWhen,
} from './time'

// Wednesday, 7 Oct 2026, 11:00 local time.
const NOW = new Date(2026, 9, 7, 11, 0).getTime()
const local = (month: number, day: number, hours: number, minutes = 0, year = 2026) =>
  new Date(year, month - 1, day, hours, minutes).getTime()
const at = (input: string) => {
  const when = parseWhen(input, NOW)
  return when && 'at' in when ? when.at : when
}

describe('parseWhen', () => {
  it('reads durations', () => {
    expect(at('15m')).toBe(NOW + 15 * 60_000)
    expect(at('30')).toBe(NOW + 30 * 60_000)
    expect(at('1h 30m')).toBe(NOW + 90 * 60_000)
    expect(at('in 2h')).toBe(NOW + 2 * 3_600_000)
    expect(at('2D')).toBe(NOW + 2 * 86_400_000)
    expect(at('45 min')).toBe(NOW + 45 * 60_000)
  })

  it('reads a clock time as today or tomorrow', () => {
    expect(at('15:00')).toBe(local(10, 7, 15))
    expect(at('9:30')).toBe(local(10, 8, 9, 30))
  })

  it('reads named days', () => {
    expect(at('tomorrow 10:00')).toBe(local(10, 8, 10))
    expect(at('tomorrow')).toBe(local(10, 8, 10))
    expect(at('today 18:00')).toBe(local(10, 7, 18))
    expect(at('fri 9:00')).toBe(local(10, 9, 9))
    expect(at('monday')).toBe(local(10, 12, 10))
    // Wednesday at 9:00 has passed today, so it is next week's.
    expect(at('wed 9:00')).toBe(local(10, 14, 9))
  })

  it('reads dates', () => {
    expect(at('25.10.2026 15:00')).toBe(local(10, 25, 15))
    expect(at('25.10 15:00')).toBe(local(10, 25, 15))
    expect(at('25.10.26')).toBe(local(10, 25, 10))
    expect(at('2026-10-25 15:00')).toBe(local(10, 25, 15))
    // Without a year a passed date means next year.
    expect(at('1.03')).toBe(local(3, 1, 10, 0, 2027))
  })

  it('explains what it cannot use', () => {
    expect(parseWhen('', NOW)).toBeNull()
    expect(parseWhen('soon', NOW)).toHaveProperty('error')
    expect(parseWhen('31.02', NOW)).toHaveProperty('error')
    expect(parseWhen('25:00', NOW)).toHaveProperty('error')
    expect(parseWhen('1.10.2026', NOW)).toEqual({ error: 'This time has already passed.' })
    expect(parseWhen('today 9:00', NOW)).toEqual({ error: 'This time has already passed.' })
  })
})

describe('formatting', () => {
  it('shows time left in one short unit', () => {
    expect(formatLeft(45_000)).toBe('45s')
    expect(formatLeft(28 * 60_000 - 1)).toBe('28m')
    expect(formatLeft(3 * 3_600_000 + 40 * 60_000)).toBe('3h')
    expect(formatLeft(2 * 86_400_000 + 5)).toBe('2d')
    expect(formatLeft(-5)).toBe('0s')
  })

  it('shows time left in words', () => {
    expect(formatLeftLong(125 * 60_000)).toBe('2 h 5 min')
    expect(formatLeftLong(27 * 3_600_000)).toBe('1 d 3 h')
    expect(formatLeftLong(18 * 86_400_000)).toBe('18 days')
  })

  it('shows the moment in English with a 24-hour clock', () => {
    expect(formatDue(local(10, 25, 15, 30))).toBe('Sun, 25.10.2026, 15:30')
    expect(formatDue(local(10, 8, 9, 5))).toBe('Thu, 08.10.2026, 09:05')
  })
})

describe('suggestWhen', () => {
  const inputs = (text: string) => suggestWhen(text, NOW).map((s) => s.input)

  it('offers units for a bare number', () => {
    expect(inputs('3')).toEqual(['3m', '3h', '3d'])
    expect(inputs('9')).toEqual(['9m', '9h', '9d', '9:00'])
  })

  it('offers the next part of a duration', () => {
    expect(inputs('1h 3')).toEqual(['1h 3m', '1h 3d'])
    expect(inputs('in 2d5')).toEqual(['2d 5m', '2d 5h'])
  })

  it('finishes a day name', () => {
    expect(inputs('t')).toEqual(['today 14:00', 'tomorrow 10:00', 'tue 10:00', 'thu 10:00'])
    expect(inputs('tues')).toEqual(['tue 10:00', 'tue 14:00', 'tue 18:00'])
  })

  it('leaves out times that have passed', () => {
    // At 11:00 today 10:00 is gone, so only the later hours are offered.
    expect(inputs('today')).toEqual(['today 14:00', 'today 18:00'])
  })

  it('finishes a clock after a day', () => {
    expect(inputs('fri 15')).toEqual(['fri 15:00', 'fri 15:30'])
    expect(inputs('15:')).toEqual(['15:00', '15:30'])
    expect(inputs('15:4')).toEqual(['15:40', '15:45'])
  })

  it('finishes a date', () => {
    expect(inputs('25.')).toEqual(['25.10', '25.11'])
    // 25.1 itself is a whole date, so it is not offered back.
    expect(inputs('25.1')).toEqual(['25.10', '25.11', '25.12'])
    expect(inputs('25.10 15:')).toEqual(['25.10 15:00', '25.10 15:30'])
  })

  it('skips months that lack the day or where it has passed', () => {
    // 31 January, 11:00: 31.1 is gone and February has no 31st, so March comes next.
    const lateJan = new Date(2026, 0, 31, 11).getTime()
    expect(suggestWhen('31.', lateJan).map((s) => s.input)).toEqual(['31.3', '31.5'])
    expect(inputs('5.')).toEqual(['5.11', '5.12'])
  })

  it('gives each suggestion its moment', () => {
    expect(suggestWhen('3', NOW)[0].at).toBe(NOW + 3 * 60_000)
    expect(suggestWhen('tues', NOW)[1].at).toBe(local(10, 13, 14))
  })

  it('notes only what the suggestion does not say', () => {
    const note = (input: string) => suggestionNote(suggestWhen(input, NOW)[0], NOW)
    expect(note('3')).toBe('11:03')
    expect(note('tues')).toBe('13.10')
    expect(note('15:')).toBe('')
  })

  it('offers nothing for what it cannot finish', () => {
    expect(inputs('')).toEqual([])
    expect(inputs('xyz')).toEqual([])
    expect(inputs('99:')).toEqual([])
  })
})
