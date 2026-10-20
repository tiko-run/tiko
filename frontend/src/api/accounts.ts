import { z } from 'zod'
import { fetchJson } from '@/api/client'
import { linkSchema } from '@/api/people'

export const accountSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  server_admin: z.boolean(),
  disabled: z.boolean(),
  in_workspace: z.boolean(),
  last_sign_in_at: z.string().nullable(),
  created_at: z.string(),
})
export type Account = z.infer<typeof accountSchema>

const accountsSchema = z.object({ accounts: z.array(accountSchema) })

export function listAccounts() {
  return fetchJson('/api/accounts', accountsSchema)
}

export function setDisabled(id: string, disabled: boolean) {
  return fetchJson(`/api/accounts/${id}`, accountSchema, {
    method: 'PATCH',
    body: JSON.stringify({ disabled }),
  })
}

export function createResetLink(id: string) {
  return fetchJson(`/api/accounts/${id}/reset`, linkSchema, { method: 'POST' })
}
