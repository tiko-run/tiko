import { z } from 'zod'
import { fetchJson } from '@/api/client'

export const taskSchema = z.object({
  // The tracker the task comes from; with the key it makes the task's ref.
  source: z.string(),
  key: z.string(),
  // private: on a public board a task from a tracker shows a guest its key only.
  state: z.enum(['ok', 'not_found', 'no_token', 'private', 'not_connected']),
  summary: z.string(),
  status_name: z.string(),
  status_category: z.enum(['new', 'indeterminate', 'done']),
  type_name: z.string(),
  assignee_name: z.string().nullable(),
  priority_name: z.string().nullable(),
  updated: z.string().nullable(),
  url: z.string(),
  fetched_at: z.string(),
  // What only some trackers have, for the mini-card: chips and extra rows.
  labels: z.array(z.object({ name: z.string(), color: z.string() })).optional(),
  rows: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  // Days as the tracker shows them, and the tracker's own field each came from.
  start: z.string().nullable().optional(),
  due: z.string().nullable().optional(),
  start_field: z.string().nullable().optional(),
  due_field: z.string().nullable().optional(),
})

export type Task = z.infer<typeof taskSchema>

/** `source` names the tracker of a bare key whose prefix two trackers know. */
export function resolveTask(ref: string, source?: string) {
  return fetchJson('/api/tasks/resolve', z.object({ task: taskSchema }), {
    method: 'POST',
    body: JSON.stringify(source ? { ref, source } : { ref }),
  }).then((body) => body.task)
}

const prefixChoicesSchema = z.object({
  choices: z.array(z.object({ prefix: z.string(), source: z.string() })),
})
export type PrefixChoices = z.infer<typeof prefixChoicesSchema>

/** Which tracker a bare key goes to when two of the person's trackers know its prefix. */
export function getPrefixChoices() {
  return fetchJson('/api/me/key-prefixes', prefixChoicesSchema)
}

export function choosePrefix(prefix: string, source: string) {
  return fetchJson(`/api/me/key-prefixes/${encodeURIComponent(prefix)}`, prefixChoicesSchema, {
    method: 'PUT',
    body: JSON.stringify({ source }),
  })
}

export function forgetPrefix(prefix: string) {
  return fetchJson(`/api/me/key-prefixes/${encodeURIComponent(prefix)}`, z.null(), {
    method: 'DELETE',
  })
}

/** `source` asks another tracker than the instance's, such as a Linear query or view link. */
export function searchTasks(jql: string, limit: number, source?: string) {
  return fetchJson(
    '/api/tasks/search',
    // `estimated`: the tracker only estimates `total`, as Jira Cloud does past its first page.
    // `total` is null when the tracker gives no count, as Linear; `more` then says more match.
    z.object({
      tasks: z.array(taskSchema),
      total: z.number().nullable(),
      estimated: z.boolean().default(false),
      more: z.boolean().default(false),
    }),
    {
      method: 'POST',
      body: JSON.stringify(source ? { jql, limit, source } : { jql, limit }),
    },
  )
}

const vocabularySchema = z.object({
  fields: z.array(
    z.object({ name: z.string(), label: z.string(), operators: z.array(z.string()) }),
  ),
  functions: z.array(z.string()),
  keywords: z.array(z.string()),
})

export type JqlVocabulary = z.infer<typeof vocabularySchema>

export function getJqlVocabulary(source?: string) {
  const params = source ? `?${new URLSearchParams({ source })}` : ''
  return fetchJson(`/api/jql/vocabulary${params}`, vocabularySchema)
}

export function getJqlValues(field: string, prefix: string, source?: string) {
  const params = new URLSearchParams({ field, prefix, ...(source ? { source } : {}) })
  return fetchJson(
    `/api/jql/values?${params}`,
    z.object({ values: z.array(z.object({ value: z.string(), label: z.string() })) }),
  ).then((body) => body.values)
}
