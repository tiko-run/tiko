import { Vote } from 'lucide-react'
import { useState } from 'react'
import { endRound, extendRound, joinRound, type Round } from '@/api/votes'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { topOverlay } from '@/lib/overlays'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useNow } from '@/timers/clock'

// The countdown turns red for its last seconds.
const HURRY_MS = 10_000

function Countdown({ endsAt }: { endsAt: string | null }) {
  const now = useNow()
  if (!endsAt) return <span className="text-muted-foreground text-xs">No time limit</span>
  const left = Math.max(Date.parse(endsAt) - now, 0)
  const seconds = Math.ceil(left / 1000)
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <span
      aria-label="Time left"
      className={cn(
        'font-mono text-sm font-semibold tabular-nums',
        left <= HURRY_MS && 'text-destructive',
      )}
    >
      {text}
    </span>
  )
}

/** "7 of 10 done"; the starter and the owner open it to see who is still voting. */
function Progress({ round }: { round: Round }) {
  const text = `${round.done_count} of ${round.joined_count} done`
  if (!round.still_voting) return <span className="text-muted-foreground text-xs">{text}</span>
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground text-xs underline decoration-dotted underline-offset-2"
        >
          {text}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-56 min-w-36 gap-0 p-1.5 text-xs">
        <p className="text-muted-foreground px-1.5 pb-1">
          {round.still_voting.length ? 'Still voting' : 'Everyone is done'}
        </p>
        <ul className="max-h-60 overflow-y-auto">
          {round.still_voting.map((name, index) => (
            <li key={index} className="truncate px-1.5 py-0.5">
              {name}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** The running round at the top of the board, for everyone on it. */
export function VotePanel({
  boardId,
  round,
  folded,
  onFold,
  onRound,
}: {
  boardId: string
  round: Round
  folded: boolean
  onFold: (done: boolean) => void
  onRound: (round: Round) => void
}) {
  const [later, setLater] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)
  const act = (call: Promise<Round>) => call.then(onRound, toastError)
  const join = () => act(joinRound(boardId, round.id))
  const manage = round.can_manage && (
    <>
      {round.ends_at && (
        <Button size="xs" variant="ghost" onClick={() => act(extendRound(boardId, round.id))}>
          +1 min
        </Button>
      )}
      <Button size="xs" variant="ghost" onClick={() => setEnding(true)}>
        End for everyone
      </Button>
    </>
  )

  let body
  if (!round.joined && later === round.id) {
    body = (
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">{round.name}</span>
        <Countdown endsAt={round.ends_at} />
        <Button size="xs" onClick={join}>
          Join
        </Button>
        {manage}
      </div>
    )
  } else if (!round.joined) {
    body = (
      <>
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{round.name}</span>
          <span className="ml-auto pl-3">
            <Countdown endsAt={round.ends_at} />
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          {round.started_by.name} started a vote: {round.votes}{' '}
          {round.votes === 1 ? 'vote' : 'votes'} each{round.anonymous ? ', anonymous' : ', open'}.
        </p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={join}>
            Join
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLater(round.id)}>
            Not now
          </Button>
          <span className="ml-auto flex">{manage}</span>
        </div>
      </>
    )
  } else if (folded) {
    body = (
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">{round.name}</span>
        <Countdown endsAt={round.ends_at} />
        <Progress round={round} />
        <Button size="xs" variant="outline" onClick={() => onFold(false)}>
          Change votes
        </Button>
        {manage}
      </div>
    )
  } else {
    body = (
      <>
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{round.name}</span>
          <span className="ml-auto pl-3">
            <Countdown endsAt={round.ends_at} />
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span aria-label="Votes left" className="font-medium">
            {round.left} of {round.votes} {round.votes === 1 ? 'vote' : 'votes'} left
          </span>
          <Progress round={round} />
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => onFold(true)}>
            Done
          </Button>
          <span className="ml-auto flex">{manage}</span>
        </div>
      </>
    )
  }

  return (
    <>
      <div
        ref={topOverlay}
        role="region"
        aria-label="Vote"
        className="bg-card absolute top-20 left-4 z-20 flex max-w-[calc(100%-2rem)] min-w-64 flex-col gap-2 rounded-lg border p-2.5 shadow-md"
      >
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
          <Vote className="size-3.5" strokeWidth={2} />
          Vote
        </span>
        {body}
      </div>
      <Dialog open={ending} onOpenChange={setEnding}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>End the vote for everyone?</DialogTitle>
            <DialogDescription>
              {round.done_count} of {round.joined_count} people are done. Votes given so far count;
              nobody can vote after this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnding(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setEnding(false)
                void act(endRound(boardId, round.id))
              }}
            >
              End vote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
