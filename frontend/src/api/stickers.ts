import { z } from 'zod'
import { fetchJson } from '@/api/client'
import { storedSchema, type FileSource } from '@/api/files'

const stickerSchema = z.object({
  code: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  category: z.string(),
})
export type Sticker = z.infer<typeof stickerSchema>

const packStickerSchema = z.object({ id: z.string(), name: z.string(), file: storedSchema })
export type PackSticker = z.infer<typeof packStickerSchema>

export function getStickers() {
  return fetchJson('/api/stickers', z.object({ stickers: z.array(stickerSchema) })).then(
    (body) => body.stickers,
  )
}

// Up to this wide a sticker is drawn for a cell of the panel, past it for a board.
const PANEL_WIDTH = 96

/** A built-in sticker drawn at least `width` wide, or playing; by the link for a guest. */
export function stickerUrl(code: string, width: number, moving = false, source?: FileSource) {
  const base =
    source && 'token' in source
      ? `/api/public/${source.token}/stickers/${code}/picture`
      : `/api/stickers/${code}/picture`
  // Two drawings only: one address each, so the browser loads each once.
  const params = `w=${width <= PANEL_WIDTH ? PANEL_WIDTH : 256}${moving ? '&move=1' : ''}`
  return `${base}?${params}`
}

/** The React Query key of the workspace's pack. */
export const PACK_KEY = ['stickers', 'pack']

export function getPack() {
  return fetchJson('/api/stickers/pack', z.object({ stickers: z.array(packStickerSchema) })).then(
    (body) => body.stickers,
  )
}

export const packPictureUrl = (id: string, width: number, moving = false) =>
  `/api/stickers/pack/${id}/picture?${moving ? 'move=1' : `w=${width}`}`

export function saveToPack(file: string, name = '') {
  return fetchJson('/api/stickers/pack', packStickerSchema, {
    method: 'POST',
    body: JSON.stringify({ file, name }),
  })
}

export function removeFromPack(id: string) {
  return fetchJson(`/api/stickers/pack/${id}`, z.null(), { method: 'DELETE' })
}

/** Lets the board serve a sticker of the pack before it goes on the board. */
export function linkPackSticker(boardId: string, id: string) {
  return fetchJson(`/api/boards/${boardId}/pack/${id}`, storedSchema, { method: 'POST' })
}
