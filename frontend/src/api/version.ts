import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchJson } from '@/api/client'

const levelSchema = z.enum(['feature', 'hotfix', 'breaking', 'security'])

const releaseSchema = z.object({
  version: z.string(),
  url: z.string(),
  level: levelSchema,
  installer: z.boolean(),
})

const versionSchema = z.object({
  version: z.string(),
  update_check: z.boolean(),
  latest: releaseSchema.nullable(),
  update_available: z.boolean(),
  level: levelSchema.nullable(),
  newer: z.array(releaseSchema),
})

export type ReleaseLevel = z.infer<typeof levelSchema>
export type VersionInfo = z.infer<typeof versionSchema>

export function getVersion() {
  return fetchJson('/api/version', versionSchema)
}

export function checkVersionNow() {
  return fetchJson('/api/version/check', versionSchema, { method: 'POST' })
}

// The server asks GitHub at most every 30 minutes, so polling more often only reads its cache.
export function useVersion() {
  return useQuery({
    queryKey: ['version'],
    queryFn: getVersion,
    staleTime: 300_000,
    refetchInterval: 300_000,
    refetchOnWindowFocus: true,
  })
}
