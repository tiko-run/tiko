import { z } from 'zod'
import { docSchema, refreshSchema } from '@/api/boards'
import { fetchJson } from '@/api/client'
import { boardPlanningSchema } from '@/api/planning'
import { taskSchema } from '@/api/tasks'

const publicBoardSchema = z.object({
  room: z.string(),
  name: z.string(),
  updated_at: z.string(),
  version: z.number(),
  doc: docSchema,
  tasks: z.record(z.string(), taskSchema),
  default_source: z.string(),
  refresh_interval_s: z.number(),
  planning: boardPlanningSchema.nullable(),
})

/** A board as a guest gets it through its public link: no sign-in, nothing about its people. */
export function getPublicBoard(token: string) {
  return fetchJson(`/api/public/${token}`, publicBoardSchema)
}

export function getPublicVersion(token: string) {
  return fetchJson(
    `/api/public/${token}/version`,
    z.object({ version: z.number(), updated_at: z.string() }),
  )
}

export function refreshPublicBoard(token: string) {
  return fetchJson(`/api/public/${token}/refresh`, refreshSchema, { method: 'POST' })
}

/** The token when this page is a public link (`/p/<token>`), else null. */
export function readPublicToken(): string | null {
  return /^\/p\/([\w-]+)\/?$/.exec(window.location.pathname)?.[1] ?? null
}
