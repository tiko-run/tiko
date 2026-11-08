import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredFile } from '@/api/files'
import { Uploads } from '@/canvas/uploads'

const LOOK = { w: 10, h: 10, color: '#000000' }
const stored = (id: string): StoredFile => ({ ...LOOK, id, width: 10, height: 10, moving: false })
const blob = () => new Blob(['x'], { type: 'image/png' })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  let n = 0
  vi.stubGlobal('URL', { createObjectURL: () => `blob:${++n}`, revokeObjectURL: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('Uploads', () => {
  it('sends a built-in sticker and keeps the address it shows meanwhile', async () => {
    const send = vi.fn().mockResolvedValue(stored('file-s'))
    const done = vi.fn()
    const uploads = new Uploads(send, done)
    uploads.add('s', { sticker: '1f525' }, LOOK, '/api/stickers/1f525/preview')
    expect(send).toHaveBeenCalledWith({ sticker: '1f525' })
    expect(uploads.get('s')?.local).toBe('/api/stickers/1f525/preview')
    await settle()
    expect(done).toHaveBeenCalledWith('s', stored('file-s'), LOOK)
    uploads.forget('s')
    // Not made by this tab: there is nothing to let go of.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('sends three at a time and tells each element its file', async () => {
    const pending: ((file: StoredFile) => void)[] = []
    const send = vi.fn(() => new Promise<StoredFile>((resolve) => pending.push(resolve)))
    const done = vi.fn()
    const uploads = new Uploads(send, done)
    for (const id of ['a', 'b', 'c', 'd']) uploads.add(id, blob(), LOOK)
    expect(send).toHaveBeenCalledTimes(3)
    expect(uploads.get('a')?.local).toBe('blob:1')
    pending[0](stored('file-a'))
    await settle()
    expect(done).toHaveBeenCalledWith('a', stored('file-a'), LOOK)
    expect(send).toHaveBeenCalledTimes(4)
  })

  it('keeps a failed upload for its retry and lets a stored one go', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('Too big'))
      .mockResolvedValue(stored('file-a'))
    const uploads = new Uploads(send, vi.fn())
    const seen = vi.fn()
    uploads.subscribe(seen)
    uploads.add('a', blob(), LOOK)
    await settle()
    expect(uploads.get('a')?.error).toBe('Too big')
    uploads.forget('a')
    expect(uploads.get('a')).toBeDefined()
    uploads.retry('a')
    await settle()
    expect(send).toHaveBeenCalledTimes(2)
    uploads.forget('a')
    expect(uploads.get('a')).toBeUndefined()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
    expect(seen).toHaveBeenCalled()
  })

  it('lets go of a dropped upload, and a late answer does not bring it back', async () => {
    let fail: (error: Error) => void = () => {}
    const send = vi.fn(() => new Promise<StoredFile>((_, reject) => (fail = reject)))
    const done = vi.fn()
    const uploads = new Uploads(send, done)
    uploads.add('a', blob(), LOOK)
    uploads.drop('a')
    fail(new Error('Gone'))
    await settle()
    expect(uploads.get('a')).toBeUndefined()
    expect(uploads.failed()).toEqual([])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
  })

  it('ignores the answer of an upload the element has since replaced', async () => {
    const pending: ((file: StoredFile) => void)[] = []
    const send = vi.fn(() => new Promise<StoredFile>((resolve) => pending.push(resolve)))
    const done = vi.fn()
    const uploads = new Uploads(send, done)
    uploads.add('a', blob(), LOOK)
    uploads.add('a', blob(), LOOK)
    pending[0](stored('old'))
    await settle()
    expect(done).not.toHaveBeenCalled()
    pending[1](stored('new'))
    await settle()
    expect(done).toHaveBeenCalledWith('a', stored('new'), LOOK)
  })
})
