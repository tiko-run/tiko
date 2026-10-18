import { z } from 'zod'
import { fetchJson } from '@/api/client'

const jiraKind = z.enum(['dc', 'cloud'])

const settingsSchema = z.object({
  provider: z.enum(['demo', 'jira']),
  refresh_interval_s: z.number(),
  secret_key_configured: z.boolean(),
  jira: z.object({
    base_url: z.string().nullable(),
    token_state: z.enum(['none', 'set', 'unreadable']),
    /** Found from the site itself; null while no URL is set. */
    kind: jiraKind.nullable().default(null),
  }),
  /** Whether board owners may make a public link. */
  public_links: z.boolean(),
  // Set in the environment by whoever deployed tiko; the form shows them read-only.
  locked: z.array(z.enum(['provider', 'jira_base_url'])).default([]),
})

export type Settings = z.infer<typeof settingsSchema>

export type SettingsChange = {
  provider?: 'demo' | 'jira'
  refresh_interval_s?: number
  // An omitted token keeps the stored one.
  jira?: { base_url: string; token?: string }
  public_links?: boolean
}

export function getSettings() {
  return fetchJson('/api/settings', settingsSchema)
}

export function saveSettings(change: SettingsChange) {
  return fetchJson('/api/settings', settingsSchema, {
    method: 'PUT',
    body: JSON.stringify(change),
  })
}

export function testJira(input: { base_url?: string; token?: string; email?: string }) {
  return fetchJson('/api/settings/jira/test', z.object({ ok: z.boolean(), user: z.string() }), {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

const trackerSchema = z.object({
  provider: z.enum(['demo', 'jira']),
  base_url: z.string().nullable(),
  token_state: z.enum(['none', 'set', 'unreadable']),
  github_token_state: z.enum(['none', 'set', 'unreadable']),
  kind: jiraKind.nullable().default(null),
  /** The person's own Jira Cloud e-mail. */
  email: z.string().nullable().default(null),
})
export type Tracker = z.infer<typeof trackerSchema>

/** The signed-in person's own tracker token. */
export function getTracker() {
  return fetchJson('/api/me/tracker', trackerSchema)
}

export type TokenSource = 'jira' | 'github'

export function saveTrackerToken(token: string, source: TokenSource = 'jira', email?: string) {
  return fetchJson('/api/me/tracker', trackerSchema, {
    method: 'PUT',
    body: JSON.stringify({ token, source, ...(email && { email }) }),
  })
}

export function removeTrackerToken(source: TokenSource = 'jira') {
  return fetchJson(`/api/me/tracker?source=${source}`, z.null(), { method: 'DELETE' })
}
