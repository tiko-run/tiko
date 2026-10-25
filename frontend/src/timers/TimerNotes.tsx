import { BellRing, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatClock } from './time'
import { describeWatch, SNOOZES } from './timer'
import type { FiredTimer } from './useTimers'

const SHOWN = 3

type Props = {
  fired: FiredTimer[]
  missed: number
  onDismissMissed: () => void
  onOpen: (id: string) => void
  onDone: (id: string) => void
  onSnooze: (id: string, ms: number) => void
}

/** Notes at the top right for timers that went off, until each is done or snoozed. */
export function TimerNotes({ fired, missed, onDismissMissed, onOpen, onDone, onSnooze }: Props) {
  if (fired.length === 0 && missed === 0) return null
  const more = fired.length - SHOWN
  return (
    <section
      aria-label="Reminders that went off"
      className="absolute top-16 right-4 z-10 flex w-72 flex-col gap-2"
    >
      {missed > 0 && (
        <div className="bg-card flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3 text-[13px] shadow-md">
          <span className="flex-1">
            {missed === 1
              ? 'A reminder went off while the board was closed.'
              : `${missed} reminders went off while the board was closed.`}
          </span>
          <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={onDismissMissed}>
            <X strokeWidth={1.75} />
          </Button>
        </div>
      )}
      {fired.slice(0, SHOWN).map((timer) => (
        <div
          key={timer.id}
          className="bg-card flex flex-col gap-1.5 rounded-lg border p-2 text-[13px] shadow-md"
        >
          <button
            type="button"
            className="flex items-center gap-2 text-left"
            onClick={() => onOpen(timer.id)}
          >
            <span
              className="timer-cube flex size-6 shrink-0 items-center justify-center rounded-md"
              data-state="fired"
            >
              <BellRing className="size-3.5" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{timer.note || 'Reminder'}</span>
              <span className="text-muted-foreground block truncate text-[12px]">
                {[
                  timer.holder && `On ${timer.holder}`,
                  timer.watch ? describeWatch(timer.watch) : `Went off at ${formatClock(timer.at)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </button>
          <div className="flex gap-1 pl-8">
            <Button size="xs" onClick={() => onDone(timer.id)}>
              Done
            </Button>
            {SNOOZES.map(({ label, ms }) => (
              <Button key={label} size="xs" variant="ghost" onClick={() => onSnooze(timer.id, ms)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      ))}
      {more > 0 && (
        <p className="text-muted-foreground px-1 text-[12px]">
          {more === 1 ? 'One more reminder went off.' : `${more} more reminders went off.`}
        </p>
      )}
    </section>
  )
}
