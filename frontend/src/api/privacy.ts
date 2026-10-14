import { z } from 'zod'
import { fetchJson } from '@/api/client'

const privacySchema = z.object({
  usage_stats: z.boolean(),
  error_reports: z.boolean(),
  // False when the instance has no address to send error reports to.
  error_reports_available: z.boolean(),
  // Set in the environment by whoever deployed tiko; the switch is read-only then.
  locked: z.array(z.enum(['usage_stats', 'error_reports'])),
  /** The exact body of the next daily ping. */
  next_ping: z.record(z.string(), z.unknown()),
})

export type Privacy = z.infer<typeof privacySchema>

export function getPrivacy() {
  return fetchJson('/api/privacy', privacySchema)
}

export function savePrivacy(change: { usage_stats?: boolean; error_reports?: boolean }) {
  return fetchJson('/api/privacy', privacySchema, { method: 'PUT', body: JSON.stringify(change) })
}
