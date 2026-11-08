import { packStickerSchema, type PackSticker } from '@/api/stickers'

/** A built-in sticker by its code, or one of the workspace's pack. */
export type StickerChoice = { code: string } | { pack: PackSticker }

/** Carries a sticker from the panel onto the board. */
export const STICKER_DRAG = 'application/x-tiko-sticker'

const CODE = /^[0-9a-f_]{1,40}$/

/** A sticker dragged from the panel; anything else dropped with its type is ignored. */
export function readStickerChoice(text: string): StickerChoice | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    if ('code' in value && typeof value.code === 'string' && CODE.test(value.code))
      return { code: value.code }
    if ('pack' in value) {
      const pack = packStickerSchema.safeParse(value.pack)
      if (pack.success) return { pack: pack.data }
    }
    return null
  } catch {
    return null
  }
}

/** A sticker lands this wide on the board, whatever size its picture is. */
export const STICKER_SIDE = 160

/** The room between stickers picked one after another. */
export const STICKER_GAP = 16

/** Width and height that fit the picture into a sticker's square. */
export function stickerSize(width: number, height: number) {
  const scale = STICKER_SIDE / Math.max(width, height, 1)
  // A picture far wider than tall keeps a sliver of height, never none.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** The tone the minimap and the board's overview give a built-in sticker. */
export const STICKER_TONE = '#f5c542'

const RECENT_KEY = 'tiko.stickers.recent'
const RECENT_LIMIT = 24

/** Built-in stickers this browser used last, newest first. */
export function readRecentStickers(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored.filter((code): code is string => typeof code === 'string').slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

export function rememberSticker(code: string) {
  const next = [code, ...readRecentStickers().filter((c) => c !== code)].slice(0, RECENT_LIMIT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Private mode or blocked storage: the panel opens on smileys instead.
  }
}
