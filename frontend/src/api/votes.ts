import { z } from 'zod'
import { fetchJson } from '@/api/client'

export const VOTES_CHANGED_EVENT = 'tiko:votes-changed'

const roundSchema = z.object({
  id: z.string(),
  name: z.string(),
  votes: z.number().int(),
  stack: z.boolean(),
  anonymous: z.boolean(),
  elements: z.array(z.string()),
  started_by: z.object({ id: z.string(), name: z.string() }),
  started_at: z.string(),
  ends_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  state: z.enum(['running', 'ended']),
  joined: z.boolean(),
  done: z.boolean(),
  mine: z.record(z.string(), z.number().int()),
  left: z.number().int(),
  joined_count: z.number().int(),
  done_count: z.number().int(),
  can_manage: z.boolean(),
  still_voting: z.array(z.string()).nullable(),
  results: z
    .array(
      z.object({
        element: z.string(),
        count: z.number().int(),
        text: z.string(),
        voters: z.array(z.object({ name: z.string(), count: z.number().int() })).nullable(),
      }),
    )
    .nullable(),
  voted_count: z.number().int().nullable(),
})
export type Round = z.infer<typeof roundSchema>

const overviewSchema = z.object({
  running: roundSchema.nullable(),
  past: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      started_at: z.string(),
      ended_at: z.string().nullable(),
      voted_count: z.number().int(),
    }),
  ),
})
export type VotesOverview = z.infer<typeof overviewSchema>

export type RoundSettings = {
  name: string
  votes: number
  stack: boolean
  minutes: number | null
  anonymous: boolean
}

const base = (boardId: string) => `/api/boards/${encodeURIComponent(boardId)}/votes`
const post = (url: string, body?: unknown) =>
  fetchJson(url, roundSchema, {
    method: 'POST',
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

export const votesKey = (boardId: string) => ['votes', boardId]

export function getVotes(boardId: string) {
  return fetchJson(base(boardId), overviewSchema)
}

export function getRound(boardId: string, roundId: string) {
  return fetchJson(`${base(boardId)}/${roundId}`, roundSchema)
}

export function startRound(boardId: string, settings: RoundSettings, elements: string[]) {
  return post(base(boardId), { ...settings, elements })
}

export const joinRound = (boardId: string, roundId: string) =>
  post(`${base(boardId)}/${roundId}/join`)

export const castVote = (boardId: string, roundId: string, element: string, delta: 1 | -1) =>
  post(`${base(boardId)}/${roundId}/ballot`, { element, delta })

export const markDone = (boardId: string, roundId: string, done: boolean) =>
  post(`${base(boardId)}/${roundId}/done`, { done })

export const extendRound = (boardId: string, roundId: string) =>
  post(`${base(boardId)}/${roundId}/extend`)

export const endRound = (boardId: string, roundId: string) =>
  post(`${base(boardId)}/${roundId}/end`)

export function renameRound(boardId: string, roundId: string, name: string) {
  return fetchJson(`${base(boardId)}/${roundId}`, roundSchema, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function deleteRound(boardId: string, roundId: string) {
  return fetchJson(`${base(boardId)}/${roundId}`, z.null(), { method: 'DELETE' })
}
