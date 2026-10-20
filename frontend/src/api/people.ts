import { z } from 'zod'
import { fetchJson } from '@/api/client'

const role = z.enum(['admin', 'member'])

export const personSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  role,
  disabled: z.boolean(),
  last_sign_in_at: z.string().nullable(),
  created_at: z.string(),
})
export type Person = z.infer<typeof personSchema>

export const inviteSchema = z.object({
  id: z.string(),
  kind: z.enum(['invite', 'reset']),
  role: role.nullable(),
  username: z.string().nullable(),
  expires_at: z.string(),
  created_at: z.string(),
})
export type Invite = z.infer<typeof inviteSchema>

const peopleSchema = z.object({ people: z.array(personSchema), invites: z.array(inviteSchema) })
export const linkSchema = z.object({ invite: inviteSchema, url: z.string() })
const infoSchema = z.object({
  kind: z.enum(['invite', 'reset']),
  role: role.nullable(),
  username: z.string().nullable(),
})
export type InviteInfo = z.infer<typeof infoSchema>

export function listPeople() {
  return fetchJson('/api/people', peopleSchema)
}

export function changeRole(id: string, newRole: Person['role']) {
  return fetchJson(`/api/people/${id}`, personSchema, {
    method: 'PATCH',
    body: JSON.stringify({ role: newRole }),
  })
}

export function createInvite(inviteRole: Person['role']) {
  return fetchJson('/api/invites', linkSchema, {
    method: 'POST',
    body: JSON.stringify({ role: inviteRole }),
  })
}

export function revokeInvite(id: string) {
  return fetchJson(`/api/invites/${id}`, z.null(), { method: 'DELETE' })
}

export function openInvite(token: string) {
  return fetchJson(`/api/invites/${encodeURIComponent(token)}`, infoSchema)
}

export function acceptInvite(
  token: string,
  body: { password: string; username?: string; name?: string },
) {
  return fetchJson(`/api/invites/${encodeURIComponent(token)}/accept`, z.null(), {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
