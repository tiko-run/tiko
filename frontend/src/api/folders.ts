import { z } from 'zod'
import { fetchJson } from '@/api/client'

const folderSchema = z.object({ id: z.string(), name: z.string(), position: z.number().int() })
export type Folder = z.infer<typeof folderSchema>

/** The person's own folders, in their order. */
export function listFolders() {
  return fetchJson('/api/folders', z.object({ folders: z.array(folderSchema) }))
}

export function createFolder(name: string) {
  return fetchJson('/api/folders', folderSchema, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function renameFolder(id: string, name: string) {
  return fetchJson(`/api/folders/${id}`, folderSchema, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

/** The folder's boards stay on Home. */
export function deleteFolder(id: string) {
  return fetchJson(`/api/folders/${id}`, z.null(), { method: 'DELETE' })
}
