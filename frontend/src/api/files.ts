import { z } from 'zod'
import { fetchJson } from '@/api/client'

const storedSchema = z.object({
  id: z.string(),
  width: z.number(),
  height: z.number(),
  color: z.string(),
  moving: z.boolean(),
})
export type StoredFile = z.infer<typeof storedSchema>

/** Sends the picture as the request body; the same bytes again answer with the stored file. */
export function uploadFile(boardId: string, file: Blob) {
  return fetchJson(`/api/boards/${boardId}/files`, storedSchema, {
    method: 'POST',
    body: file,
    headers: { 'content-type': file.type },
  })
}

/** Where a picture is read: by the board for its people, by the link for a guest. */
export type FileSource = { boardId: string } | { token: string }

/** A copy at least `width` wide, or with `moving` the picture playing. */
export function fileUrl(source: FileSource, file: string, width?: number, moving = false) {
  const base =
    'token' in source
      ? `/api/public/${source.token}/files/${file}`
      : `/api/boards/${source.boardId}/files/${file}`
  if (moving) return `${base}?move=1`
  return width ? `${base}?w=${width}` : base
}
