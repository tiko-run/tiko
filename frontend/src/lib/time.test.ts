import { expect, test } from 'vitest'
import { relativeTime, shortDate } from '@/lib/time'

const now = Date.parse('2026-10-05T12:00:00Z')

test('formats past times in the largest whole unit', () => {
  expect(relativeTime('2026-10-05T11:59:30Z', now)).toBe('just now')
  expect(relativeTime('2026-10-05T11:55:00Z', now)).toBe('5 minutes ago')
  expect(relativeTime('2026-10-05T09:00:00Z', now)).toBe('3 hours ago')
  expect(relativeTime('2026-10-04T12:00:00Z', now)).toBe('yesterday')
  expect(relativeTime('2026-09-21T12:00:00Z', now)).toBe('2 weeks ago')
})

test('returns null for a missing or broken date', () => {
  expect(relativeTime(null, now)).toBeNull()
  expect(relativeTime('not a date', now)).toBeNull()
})

test('writes the day in words and adds the year outside the current one', () => {
  const noon = (year: number) => new Date(year, 10, 16, 12).getTime()
  expect(shortDate(noon(2026), noon(2026))).toBe('Nov 16')
  expect(shortDate(noon(2027), noon(2026))).toBe('Nov 16, 2027')
  expect(shortDate(noon(2025), noon(2026))).toBe('Nov 16, 2025')
})
