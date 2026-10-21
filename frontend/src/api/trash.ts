import { z } from 'zod'
import { fetchJson } from '@/api/client'

const personSchema = z.object({ id: z.string(), name: z.string() })

const trashedSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: personSchema.nullable(),
  deleted_at: z.string(),
  /** Null once the person who deleted it has no account any more. */
  deleted_by: personSchema.nullable(),
  /** When the board goes for good. */
  purge_at: z.string(),
})
export type TrashedBoard = z.infer<typeof trashedSchema>

/** The person's trashed boards, newest first; a workspace admin gets the whole workspace's. */
export function listTrash() {
  return fetchJson('/api/trash', z.object({ boards: z.array(trashedSchema) }))
}

/** Brings the board back with its members, roles and public link. */
export function restoreBoard(id: string) {
  return fetchJson(`/api/boards/${id}/restore`, z.null(), { method: 'POST' })
}

/** Only a board in the trash, and only its owner. */
export function deleteForever(id: string) {
  return fetchJson(`/api/boards/${id}?forever=1`, z.null(), { method: 'DELETE' })
}
