import { describe, expect, it } from 'vitest'
import { hasRange, MAX_REFS, pastedRefs, splitRefs } from './refs'

describe('splitRefs', () => {
  it('splits keys by commas and spaces, once each', () => {
    expect(splitRefs('APP-1, APP-2 APP-1')).toEqual(['APP-1', 'APP-2'])
  })

  it('expands a range of keys', () => {
    expect(splitRefs('APP-1 - APP-4')).toEqual(['APP-1', 'APP-2', 'APP-3', 'APP-4'])
    expect(splitRefs('APP-1..3')).toEqual(['APP-1', 'APP-2', 'APP-3'])
    expect(splitRefs('APP-8 – APP-9, X-1')).toEqual(['APP-8', 'APP-9', 'X-1'])
    expect(splitRefs('APP-1..1')).toEqual(['APP-1'])
  })

  it('expands a backwards range in order', () => {
    expect(splitRefs('app-3 - app-1')).toEqual(['app-1', 'app-2', 'app-3'])
  })

  it('expands a range of GitHub tasks in one repo', () => {
    expect(splitRefs('acme/web#2 - #4')).toEqual(['acme/web#2', 'acme/web#3', 'acme/web#4'])
  })

  it('leaves keys of two projects as two keys', () => {
    expect(splitRefs('APP-1 - WEB-5')).toEqual(['APP-1', '-', 'WEB-5'])
  })

  it('stops a huge range one past the limit', () => {
    expect(splitRefs('APP-1 - APP-1000000')).toHaveLength(MAX_REFS + 1)
  })

  it('does not read a key inside a link as a range', () => {
    expect(splitRefs('https://jira.example.com/browse/APP-1')).toEqual([
      'https://jira.example.com/browse/APP-1',
    ])
  })
})

describe('hasRange', () => {
  it('tells a range from a list', () => {
    expect(hasRange('APP-1 - APP-3')).toBe(true)
    expect(hasRange('APP-1, APP-3')).toBe(false)
  })
})

describe('pastedRefs', () => {
  it('turns a pasted range into keys', () => {
    expect(pastedRefs('APP-1 - APP-2')).toEqual({ refs: ['APP-1', 'APP-2'], more: false })
  })

  it('says when a range runs past the limit', () => {
    expect(pastedRefs('APP-1..51')?.more).toBe(true)
    expect(pastedRefs('APP-1..50')?.more).toBe(false)
  })
})
