import { z } from 'zod'
import { fetchJson } from '@/api/client'

const privacySchema = z.object({
  usage_stats: z.boolean(),
  // Set in the environment by whoever deployed tiko; the switch is read-only then.
  locked: z.array(z.literal('usage_stats')),
  /** The exact body of the next daily ping. */
  next_ping: z.record(z.string(), z.unknown()),
})

export type Privacy = z.infer<typeof privacySchema>

export function getPrivacy() {
  return fetchJson('/api/privacy', privacySchema)
}

export function savePrivacy(change: { usage_stats: boolean }) {
  return fetchJson('/api/privacy', privacySchema, { method: 'PUT', body: JSON.stringify(change) })
}
