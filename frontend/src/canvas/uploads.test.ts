import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Uploads } from '@/canvas/uploads'

const blob = () => new Blob(['x'], { type: 'image/png' })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  let n = 0
  vi.stubGlobal('URL', { createObjectURL: () => `blob:${++n}`, revokeObjectURL: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('Uploads', () => {
  it('sends three at a time and tells each element its file', async () => {
    const pending: ((id: string) => void)[] = []
    const send = vi.fn(() => new Promise<string>((resolve) => pending.push(resolve)))
    const done = vi.fn()
    const uploads = new Uploads(send, done)
    for (const id of ['a', 'b', 'c', 'd']) uploads.add(id, blob())
    expect(send).toHaveBeenCalledTimes(3)
    expect(uploads.get('a')?.local).toBe('blob:1')
    pending[0]('file-a')
    await settle()
    expect(done).toHaveBeenCalledWith('a', 'file-a')
    expect(send).toHaveBeenCalledTimes(4)
  })

  it('keeps a failed upload for its retry and lets a stored one go', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('Too big')).mockResolvedValue('file-a')
    const uploads = new Uploads(send, vi.fn())
    const seen = vi.fn()
    uploads.subscribe(seen)
    uploads.add('a', blob())
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
})
