import { afterEach, describe, expect, it } from 'vitest'
import {
  readRecentStickers,
  readStickerChoice,
  rememberSticker,
  STICKER_SIDE,
  stickerSize,
} from '@/canvas/stickers'

afterEach(() => localStorage.clear())

describe('stickers', () => {
  it('fits a picture into the sticker square by its longer side', () => {
    expect(stickerSize(400, 300)).toEqual({ width: STICKER_SIDE, height: 120 })
    expect(stickerSize(100, 200)).toEqual({ width: 80, height: STICKER_SIDE })
    expect(stickerSize(4000, 1)).toEqual({ width: STICKER_SIDE, height: 1 })
  })

  it('takes only a sticker of the panel from a drop', () => {
    const pack = {
      id: 'p1',
      name: 'Logo',
      file: { id: 'f1', width: 4, height: 3, color: '#000000', moving: false },
    }
    expect(readStickerChoice('{"code":"1f525"}')).toEqual({ code: '1f525' })
    expect(readStickerChoice(JSON.stringify({ pack }))).toEqual({ pack })
    for (const text of ['{"code":0}', '{"code":"../x"}', '{"pack":{"id":1}}', 'null', '{'])
      expect(readStickerChoice(text)).toBeNull()
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
