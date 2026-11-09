import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  castVote,
  getVotes,
  markDone,
  VOTES_CHANGED_EVENT,
  votesKey,
  type Round,
  type VotesOverview,
} from '@/api/votes'
import type { AppNode } from '@/canvas/types'
import { toastError } from '@/lib/toast'

const RETRY_MS = 2000

/** Opens the board's past votes; the board menu sends it. */
export const OPEN_VOTES_EVENT = 'tiko:open-votes'

export type VotingHost = {
  round: Round | null
  /** The person is voting now: pluses on the elements, the rest of the board dimmed. */
  active: boolean
  vote: (element: string, delta: 1 | -1) => void
}

export const VotingContext = createContext<VotingHost>({
  round: null,
  active: false,
  vote: () => {},
})
export const useVotingHost = () => useContext(VotingContext)

/** The board's votes, read again whenever the board's socket says they changed. */
export function useVoting(boardId: string, enabled: boolean) {
  const client = useQueryClient()
  const key = votesKey(boardId)
  const query = useQuery({ queryKey: key, queryFn: () => getVotes(boardId), enabled })
  const reread = useCallback(
    () => void client.invalidateQueries({ queryKey: votesKey(boardId) }),
    [client, boardId],
  )
  useEffect(() => {
    window.addEventListener(VOTES_CHANGED_EVENT, reread)
    return () => window.removeEventListener(VOTES_CHANGED_EVENT, reread)
  }, [reread])

  const running = query.data?.running ?? null
  // The first to look after the time runs out ends the round on the server.
  const endsAt = running?.ends_at
  useEffect(() => {
    if (!endsAt) return
    let retry = 0
    const wait = Math.max(Date.parse(endsAt) - Date.now() + 500, 0)
    // A clock ahead of the server's asks too early: ask again until the round is over.
    const timer = window.setTimeout(() => {
      reread()
      retry = window.setInterval(reread, RETRY_MS)
    }, wait)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(retry)
    }
  }, [endsAt, reread])

  // Answers to this tab's own requests can come back out of order; only the latest counts.
  const sent = useRef(0)
  const put = useCallback(
    (round: Round, request?: number) => {
      if (request !== undefined && request !== sent.current) return
      client.setQueryData<VotesOverview>(votesKey(boardId), (old) => {
        // A late answer must not bring back a round that has ended since.
        if (old?.past.some((past) => past.id === round.id)) return old
        const next = round.state === 'running' ? round : null
        return old ? { ...old, running: next } : { running: next, past: [] }
      })
    },
    [client, boardId],
  )

  // Done folds the person's voting away; their votes stay. Until they press it or Change
  // votes here, the server's word holds, so a reload keeps the panel folded.
  const [override, setOverride] = useState<{ id: string; folded: boolean } | null>(null)
  const folded =
    override && override.id === running?.id ? override.folded : Boolean(running?.marked_done)
  const active = Boolean(running?.joined) && !folded

  const vote = useCallback(
    (element: string, delta: 1 | -1) => {
      if (!running) return
      const request = ++sent.current
      castVote(boardId, running.id, element, delta).then(
        (round) => put(round, request),
        (error: Error) => {
          toastError(error)
          reread()
        },
      )
    },
    [boardId, running, put, reread],
  )
  const fold = useCallback(
    (done: boolean) => {
      if (!running) return
      setOverride({ id: running.id, folded: done })
      const request = ++sent.current
      markDone(boardId, running.id, done).then(
        (round) => put(round, request),
        (error: Error) => {
          toastError(error)
          setOverride(null)
          reread()
        },
      )
    },
    [boardId, running, put, reread],
  )

  const host = useMemo<VotingHost>(
    () => ({ round: running, active, vote }),
    [running, active, vote],
  )
  return { overview: query.data, running, host, put, reread, fold, folded }
}

/** Whether the element is in the running round, so its text and look stay as they are. */
export function useInVote(id: string) {
  const { round } = useVotingHost()
  return Boolean(round?.elements.includes(id))
}

const votable = (type: string | undefined) => type === 'sticky' || type === 'task_card'

/** The notes and cards a vote takes from a selection: picked ones and those in picked frames. */
export function voteElements(nodes: AppNode[]): string[] {
  const frames = new Set(nodes.filter((n) => n.selected && n.type === 'frame').map((n) => n.id))
  return nodes
    .filter((n) => votable(n.type) && (n.selected || (n.parentId && frames.has(n.parentId))))
    .map((n) => n.id)
}
