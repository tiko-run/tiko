import { afterEach, describe, expect, it } from 'vitest'
import {
  readRecentStickers,
  rememberSticker,
  STICKER_SIDE,
  stickerSize,
  stickerTone,
} from '@/canvas/stickers'

afterEach(() => localStorage.clear())

describe('stickers', () => {
  it('fits a picture into the sticker square by its longer side', () => {
    expect(stickerSize(400, 300)).toEqual({ width: STICKER_SIDE, height: 120 })
    expect(stickerSize(100, 200)).toEqual({ width: 80, height: STICKER_SIDE })
  })

  it('gives each sticker a light tone of its own that a board accepts', () => {
    expect(stickerTone('1f525')).toMatch(/^#[c-f][0-9a-f][c-f][0-9a-f][c-f][0-9a-f]$/)
    expect(stickerTone('1f525')).toBe(stickerTone('1f525'))
    expect(stickerTone('1f525')).not.toBe(stickerTone('1f680'))
  })

  it('remembers the stickers used last, newest first, once each', () => {
    rememberSticker('1f525')
    rememberSticker('1f680')
    rememberSticker('1f525')
    expect(readRecentStickers()).toEqual(['1f525', '1f680'])
  })

  it('reads nothing from a broken store', () => {
    localStorage.setItem('tiko.stickers.recent', '{')
    expect(readRecentStickers()).toEqual([])
  })
})
