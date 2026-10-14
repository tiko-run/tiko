import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchJson } from '@/api/client'

const statusSchema = z.object({
  state: z.enum(['idle', 'running', 'done', 'failed']),
  step: z.string().nullable(),
  target: z.string().nullable(),
  downloaded: z.number(),
  total: z.number(),
  error: z.string().nullable(),
  log: z.array(z.string()),
})

const updateSchema = z.object({
  available: z.boolean(),
  hosting: z.enum(['railway', 'render']).nullable(),
  status: statusSchema.nullable(),
})

export type UpdateInfo = z.infer<typeof updateSchema>

export function getUpdate() {
  return fetchJson('/api/update', updateSchema)
}

export function startUpdate() {
  return fetchJson('/api/update', updateSchema, { method: 'POST' })
}

// Polled fast only while an update runs; the API is down for a while then, so no retries.
export function useUpdate(enabled: boolean) {
  return useQuery({
    queryKey: ['update'],
    queryFn: getUpdate,
    enabled,
    retry: false,
    refetchInterval: (query) => (query.state.data?.status?.state === 'running' ? 1500 : false),
  })
}
