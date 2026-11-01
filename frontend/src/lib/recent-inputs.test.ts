import { beforeEach, expect, test } from 'vitest'
import { readRecentInputs, rememberInput } from '@/lib/recent-inputs'

beforeEach(() => localStorage.clear())

test('keeps the last five distinct inputs, newest first', () => {
  for (const input of ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4', 'DEMO-5', 'DEMO-6'])
    rememberInput(input)
  expect(readRecentInputs()).toEqual(['DEMO-6', 'DEMO-5', 'DEMO-4', 'DEMO-3', 'DEMO-2'])
  rememberInput(' DEMO-3 ')
  expect(readRecentInputs()).toEqual(['DEMO-3', 'DEMO-6', 'DEMO-5', 'DEMO-4', 'DEMO-2'])
})

test('a broken value reads as an empty list', () => {
  localStorage.setItem('tiko.card.recent', '{oops')
  expect(readRecentInputs()).toEqual([])
  rememberInput('')
  expect(localStorage.getItem('tiko.card.recent')).toBe('{oops')
})
