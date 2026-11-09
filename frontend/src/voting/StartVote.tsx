import { useState, type ReactNode } from 'react'
import { startRound, type Round } from '@/api/votes'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toastError } from '@/lib/toast'

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(Number.isFinite(value) ? Math.round(value) : low, low), high)

function Row({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** Settings of a new round, started on the selected notes and cards. */
export function StartVote({
  boardId,
  elements,
  number,
  open,
  onOpenChange,
  onStarted,
}: {
  boardId: string
  elements: string[]
  /** The round's number on the board, for its default name. */
  number: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: (round: Round) => void
}) {
  const [name, setName] = useState('')
  const [votes, setVotes] = useState(5)
  const [stack, setStack] = useState(true)
  const [timed, setTimed] = useState(true)
  const [minutes, setMinutes] = useState(5)
  const [anonymous, setAnonymous] = useState(true)
  const [busy, setBusy] = useState(false)

  const start = () => {
    setBusy(true)
    startRound(
      boardId,
      {
        name: name.trim() || `Vote ${number}`,
        votes: clamp(votes, 1, 99),
        stack,
        minutes: timed ? clamp(minutes, 1, 60) : null,
        anonymous,
      },
      elements,
    )
      .then((round) => {
        onOpenChange(false)
        onStarted(round)
      }, toastError)
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Start a vote</DialogTitle>
          <DialogDescription>
            On {elements.length} {elements.length === 1 ? 'element' : 'elements'}. Nobody sees the
            others' votes until the end, and the elements stay as they are until then.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            start()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vote-name">Name</Label>
            <Input
              id="vote-name"
              value={name}
              maxLength={100}
              placeholder={`Vote ${number}`}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Row id="vote-count" label="Votes per person">
            <Input
              id="vote-count"
              type="number"
              min={1}
              max={99}
              className="w-20"
              value={votes}
              onChange={(event) => setVotes(event.target.valueAsNumber)}
            />
          </Row>
          <Row
            id="vote-stack"
            label="Several votes on one element"
            hint="Off: each person's votes go to different elements."
          >
            <Switch id="vote-stack" checked={stack} onCheckedChange={setStack} />
          </Row>
          <Row id="vote-timed" label="Timer">
            <div className="flex items-center gap-2">
              {timed && (
                <>
                  <Input
                    aria-label="Minutes"
                    type="number"
                    min={1}
                    max={60}
                    className="w-16"
                    value={minutes}
                    onChange={(event) => setMinutes(event.target.valueAsNumber)}
                  />
                  <span className="text-muted-foreground text-sm">min</span>
                </>
              )}
              <Switch id="vote-timed" checked={timed} onCheckedChange={setTimed} />
            </div>
          </Row>
          <Row
            id="vote-anonymous"
            label="Anonymous"
            hint={
              anonymous
                ? 'Results show counts only.'
                : 'Results show who gave how many votes to each element.'
            }
          >
            <Switch id="vote-anonymous" checked={anonymous} onCheckedChange={setAnonymous} />
          </Row>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || elements.length === 0}>
              Start vote
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
