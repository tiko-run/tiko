import { afterEach, describe, expect, it } from 'vitest'
import { readRecentStickers, rememberSticker, STICKER_SIDE, stickerSize } from '@/canvas/stickers'

afterEach(() => localStorage.clear())

describe('stickers', () => {
  it('fits a picture into the sticker square by its longer side', () => {
    expect(stickerSize(400, 300)).toEqual({ width: STICKER_SIDE, height: 120 })
    expect(stickerSize(100, 200)).toEqual({ width: 80, height: STICKER_SIDE })
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
