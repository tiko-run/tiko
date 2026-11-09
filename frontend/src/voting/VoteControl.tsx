import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVotingHost } from '@/voting/useVoting'

const OWN_POINTER = 'nodrag nopan nowheel'

/** The person's votes on an element of the running round, at its top right corner. */
export function VoteControl({ id }: { id: string }) {
  const { round, active, vote } = useVotingHost()
  if (!round || !active || !round.elements.includes(id)) return null
  const count = round.mine[id] ?? 0
  const more = round.left > 0 && (round.stack || count === 0)
  return (
    <div
      className={cn(
        OWN_POINTER,
        'absolute -top-3 -right-3 z-20 flex h-7 items-center rounded-full shadow-md',
        count > 0 ? 'bg-primary text-primary-foreground' : 'bg-card border',
      )}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {count > 0 && (
        <button
          type="button"
          aria-label="Take back a vote"
          className="flex size-7 items-center justify-center rounded-full hover:bg-black/10"
          onClick={() => vote(id, -1)}
        >
          <Minus className="size-3.5" strokeWidth={2.5} />
        </button>
      )}
      {count > 0 && (
        <span
          className="min-w-3 text-center text-sm font-semibold tabular-nums"
          aria-label="Your votes"
        >
          {count}
        </span>
      )}
      <button
        type="button"
        aria-label="Vote"
        disabled={!more}
        className={cn(
          'flex size-7 items-center justify-center rounded-full disabled:opacity-40',
          count > 0 ? 'hover:bg-black/10' : 'text-primary hover:bg-accent',
        )}
        onClick={() => vote(id, 1)}
      >
        <Plus className="size-4" strokeWidth={2.5} />
      </button>
    </div>
  )
}
