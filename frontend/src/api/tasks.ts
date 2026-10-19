import { z } from 'zod'
import { fetchJson } from '@/api/client'

export const taskSchema = z.object({
  // The tracker the task comes from; with the key it makes the task's ref.
  source: z.string(),
  key: z.string(),
  // private: on a public board a task from a tracker shows a guest its key only.
  state: z.enum(['ok', 'not_found', 'no_token', 'private']),
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
})

export type Task = z.infer<typeof taskSchema>

export function resolveTask(ref: string) {
  return fetchJson('/api/tasks/resolve', z.object({ task: taskSchema }), {
    method: 'POST',
    body: JSON.stringify({ ref }),
  }).then((body) => body.task)
}

export function searchTasks(jql: string, limit: number) {
  return fetchJson(
    '/api/tasks/search',
    // `estimated`: the tracker only estimates `total`, as Jira Cloud does past its first page.
    z.object({
      tasks: z.array(taskSchema),
      total: z.number(),
      estimated: z.boolean().default(false),
    }),
    {
      method: 'POST',
      body: JSON.stringify({ jql, limit }),
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

export function getJqlVocabulary() {
  return fetchJson('/api/jql/vocabulary', vocabularySchema)
}

export function getJqlValues(field: string, prefix: string) {
  const params = new URLSearchParams({ field, prefix })
  return fetchJson(
    `/api/jql/values?${params}`,
    z.object({ values: z.array(z.object({ value: z.string(), label: z.string() })) }),
  ).then((body) => body.values)
}
