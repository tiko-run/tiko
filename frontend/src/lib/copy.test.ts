import { afterEach, expect, test, vi } from 'vitest'
import { copyLink } from '@/lib/copy'

afterEach(() => vi.unstubAllGlobals())

test('selects the link when the page has no clipboard', async () => {
  vi.stubGlobal('navigator', {})
  const field = document.createElement('input')
  field.value = 'http://192.0.2.1:3000/p/abc'
  document.body.append(field)
  expect(await copyLink(field.value, field)).toBe(false)
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
  field.remove()
})

test('copies the link when the clipboard is there', async () => {
  const writeText = vi.fn(async () => undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  expect(await copyLink('https://tiko.example/p/abc', null)).toBe(true)
  expect(writeText).toHaveBeenCalledWith('https://tiko.example/p/abc')
})
