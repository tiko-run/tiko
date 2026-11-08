import { z } from 'zod'
import { fetchJson } from '@/api/client'
import { taskSchema } from '@/api/tasks'

const listSchema = z.object({
  // The list's address on the server.
  id: z.string(),
  name: z.string(),
  color: z.string(),
  shown: z.boolean(),
})

export type TaskList = z.infer<typeof listSchema>

const accountSchema = z.object({
  state: z.enum(['none', 'set', 'unreadable']),
  address: z.string().nullable(),
  username: z.string().nullable(),
})

export type CalDavAccount = z.infer<typeof accountSchema>

const connectedSchema = accountSchema.extend({
  display_name: z.string(),
  lists: z.array(listSchema),
})

const listsSchema = z.object({ lists: z.array(listSchema) })

/** The signed-in person's own CalDAV account; the password never comes back. */
export function getCalDav() {
  return fetchJson('/api/me/caldav', accountSchema)
}

/** Checks the account with the server and stores it; a blank password keeps the stored one. */
export function connectCalDav(input: { address: string; username: string; password?: string }) {
  return fetchJson('/api/me/caldav', connectedSchema, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function removeCalDav() {
  return fetchJson('/api/me/caldav', z.null(), { method: 'DELETE' })
}

export function getCalDavLists() {
  return fetchJson('/api/me/caldav/lists', listsSchema).then((body) => body.lists)
}

export function hideCalDavLists(hidden: string[]) {
  return fetchJson('/api/me/caldav/lists', listsSchema, {
    method: 'PUT',
    body: JSON.stringify({ hidden }),
  }).then((body) => body.lists)
}

export function getListTasks(listId: string, done: boolean) {
  return fetchJson(
    '/api/tasks/caldav',
    z.object({ tasks: z.array(taskSchema), total: z.number() }),
    {
      method: 'POST',
      body: JSON.stringify({ list_id: listId, done }),
    },
  )
}
