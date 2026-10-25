import { z } from 'zod'
import { fetchJson } from '@/api/client'

export const meSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  // The role in the workspace; null for someone in no workspace.
  role: z.enum(['admin', 'member']).nullable(),
  // Runs the server: updates, privacy and accounts.
  server_admin: z.boolean(),
  workspace: z.object({ id: z.string(), name: z.string() }).nullable(),
  // Set for a demo visitor: when their boards are deleted unless they come back.
  demo_expires_at: z.string().nullish(),
  // The first admin, until they replace the password from the log or a file.
  must_change_password: z.boolean().optional(),
})
export type Me = z.infer<typeof meSchema>

const statusSchema = z.object({
  signed_in: z.boolean(),
  me: meSchema.nullable(),
  // The instance is a public demo: anyone starts without an account.
  demo: z.boolean().optional(),
})

export function getAuthStatus() {
  return fetchJson('/api/auth/status', statusSchema)
}

export function signIn(credentials: { username: string; password: string }) {
  return fetchJson('/api/auth/login', z.null(), {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

export function startDemo() {
  return fetchJson('/api/auth/demo', z.null(), { method: 'POST' })
}

export function signUp(account: { name: string; username: string; password: string }) {
  return fetchJson('/api/auth/signup', meSchema, { method: 'POST', body: JSON.stringify(account) })
}

export function signOut() {
  return fetchJson('/api/auth/logout', z.null(), { method: 'POST' })
}

export function signOutEverywhere() {
  return fetchJson('/api/auth/logout-all', z.null(), { method: 'POST' })
}

export function updateMe(change: { name?: string; username?: string }) {
  return fetchJson('/api/me', meSchema, { method: 'PATCH', body: JSON.stringify(change) })
}

export function changePassword(change: { current: string; new: string }) {
  return fetchJson('/api/me/password', z.null(), {
    method: 'PUT',
    body: JSON.stringify(change),
  })
}
