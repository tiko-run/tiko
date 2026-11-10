import { z } from 'zod'
import { fetchJson } from '@/api/client'

const scopeSchema = z.enum(['read', 'write'])
export type ApiKeyScope = z.infer<typeof scopeSchema>

export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: scopeSchema,
  /** The chosen board ids; null reaches all the person's boards. */
  boards: z.array(z.string()).nullable(),
  /** The first characters after `tiko_`, to tell keys apart. */
  prefix: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  /** A day, not a moment: "2026-11-08". */
  last_used_on: z.string().nullable(),
})
export type ApiKey = z.infer<typeof apiKeySchema>

const listSchema = z.object({
  keys: z.array(apiKeySchema),
  /** Whether the workspace's admin lets people make keys. */
  enabled: z.boolean(),
})
const createdSchema = z.object({ key: apiKeySchema, token: z.string() })

export type NewApiKey = {
  name: string
  scope: ApiKeyScope
  boards: string[] | null
  days: number
  password: string
}

const DAY_MS = 24 * 3600 * 1000

/** Whole days until the key expires; 0 or less once it has. */
export function daysLeft(key: Pick<ApiKey, 'expires_at'>, now = Date.now()) {
  return Math.ceil((Date.parse(key.expires_at) - now) / DAY_MS)
}

export function listApiKeys() {
  return fetchJson('/api/me/api-keys', listSchema)
}

export function createApiKey(key: NewApiKey) {
  return fetchJson('/api/me/api-keys', createdSchema, {
    method: 'POST',
    body: JSON.stringify(key),
  })
}

export function revokeApiKey(id: string) {
  return fetchJson(`/api/me/api-keys/${id}`, z.null(), { method: 'DELETE' })
}
