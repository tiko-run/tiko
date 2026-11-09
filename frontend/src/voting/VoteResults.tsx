import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import {
  deleteRound,
  getRound,
  renameRound,
  votesKey,
  type Round,
  type VotesOverview,
} from '@/api/votes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** A finished round's ranking, and the board's past rounds. */
export function VoteResults({
  boardId,
  overview,
  roundId,
  onPick,
  onClose,
  onFly,
  exists,
}: {
  boardId: string
  overview: VotesOverview | undefined
  /** The round shown; null lists the past rounds. */
  roundId: string | null
  onPick: (roundId: string | null) => void
  onClose: () => void
  onFly: (element: string) => void
  exists: (element: string) => boolean
}) {
  const client = useQueryClient()
  const round = useQuery({
    queryKey: [...votesKey(boardId), roundId],
    queryFn: () => getRound(boardId, roundId!),
    enabled: roundId !== null,
  }).data
  const [renaming, setRenaming] = useState(false)
  const reread = () => client.invalidateQueries({ queryKey: votesKey(boardId) })

  return (
    <div
      role="region"
      aria-label="Vote results"
      className="bg-card absolute top-20 right-4 z-20 flex max-h-[calc(100%-7rem)] w-80 max-w-[calc(100%-2rem)] flex-col rounded-lg border shadow-md"
    >
      <div className="flex items-center gap-1 border-b p-2">
        {roundId !== null && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="All votes"
            onClick={() => onPick(null)}
          >
            <ChevronLeft />
          </Button>
        )}
        {roundId !== null && round && renaming ? (
          <form
            className="flex-1"
            onSubmit={(event) => {
              event.preventDefault()
              const name = new FormData(event.currentTarget).get('name')?.toString().trim()
              setRenaming(false)
              if (name && name !== round.name)
                renameRound(boardId, round.id, name).then(reread, toastError)
            }}
          >
            <Input
              name="name"
              defaultValue={round.name}
              maxLength={100}
              autoFocus
              className="h-7"
            />
          </form>
        ) : (
          <span className="flex-1 truncate px-1 text-sm font-semibold">
            {roundId === null ? 'Votes' : (round?.name ?? '…')}
          </span>
        )}
        {round?.can_manage && roundId !== null && !renaming && (
          <>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Rename vote"
              onClick={() => setRenaming(true)}
            >
              <Pencil />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Delete vote"
              onClick={() =>
                deleteRound(boardId, round.id).then(() => {
                  onPick(null)
                  void reread()
                }, toastError)
              }
            >
              <Trash2 />
            </Button>
          </>
        )}
        <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="overflow-y-auto p-2">
        {roundId === null ? (
          <Past overview={overview} onPick={onPick} />
        ) : round ? (
          <Ranking round={round} onFly={onFly} exists={exists} />
        ) : null}
      </div>
    </div>
  )
}

function Past({
  overview,
  onPick,
}: {
  overview: VotesOverview | undefined
  onPick: (roundId: string) => void
}) {
  const past = overview?.past ?? []
  if (!past.length)
    return (
      <p className="text-muted-foreground p-2 text-sm">
        No votes yet. Select notes or cards and press Vote in the bar above them.
      </p>
    )
  return (
    <ul className="flex flex-col">
      {past.map((round) => (
        <li key={round.id}>
          <button
            type="button"
            className="hover:bg-accent flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            onClick={() => onPick(round.id)}
          >
            <span className="flex-1 truncate">{round.name}</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {dateFormat.format(new Date(round.started_at))} · {round.voted_count} voted
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Ranking({
  round,
  onFly,
  exists,
}: {
  round: Round
  onFly: (element: string) => void
  exists: (element: string) => boolean
}) {
  const results = round.results ?? []
  const top = Math.max(1, ...results.map((r) => r.count))
  return (
    <>
      <p className="text-muted-foreground px-1 pb-2 text-xs">
        {round.voted_count ?? 0} {round.voted_count === 1 ? 'person' : 'people'} voted ·{' '}
        {round.anonymous ? 'anonymous' : 'open'}
      </p>
      {!results.length && <p className="text-muted-foreground px-1 text-sm">Nobody voted.</p>}
      <ol className="flex flex-col gap-1">
        {results.map((row, index) => {
          const here = exists(row.element)
          return (
            <li key={row.element}>
              <button
                type="button"
                disabled={!here}
                className="hover:bg-accent flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left disabled:hover:bg-transparent"
                onClick={() => onFly(row.element)}
              >
                <span className="flex items-baseline gap-2 text-sm">
                  <span className="text-muted-foreground w-4 shrink-0 text-xs tabular-nums">
                    {index + 1}
                  </span>
                  <span className={cn('line-clamp-2 flex-1', !here && 'text-muted-foreground')}>
                    {row.text || (here ? 'Untitled' : '')}
                    {!here && <span className="block text-xs italic">No longer on the board</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{row.count}</span>
                </span>
                <span className="bg-muted ml-6 h-1.5 overflow-hidden rounded-full">
                  <span
                    className="bg-primary block h-full rounded-full"
                    style={{ width: `${(row.count / top) * 100}%` }}
                  />
                </span>
                {row.voters && (
                  <span className="text-muted-foreground ml-6 text-xs">
                    {row.voters
                      .map((v) => (v.count > 1 ? `${v.name} ×${v.count}` : v.name))
                      .join(', ')}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </>
  )
}
