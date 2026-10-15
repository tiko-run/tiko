import { AlarmClock, BellRing, Check, Eye, X } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatClock, formatDue, formatLeft } from './time'
import { describeWatch, SNOOZES, type TimerState } from './timer'
import { setTimerPanelOpen, useTimerPanelOpen } from './panel'
import { groupTimers, sameDay } from './groups'
import type { TimerEntry } from './useTimers'

const ICONS: Record<TimerState, typeof AlarmClock> = {
  running: AlarmClock,
  soon: AlarmClock,
  fired: BellRing,
  done: Check,
  watching: Eye,
}

function when(timer: TimerEntry, now: number) {
  if (timer.watch && timer.state !== 'done') return describeWatch(timer.watch)
  if (timer.state === 'fired') return `Went off at ${formatClock(timer.at!)}`
  if (timer.state === 'done') return 'Done'
  if (timer.at === null) return 'Waiting'
  const at = sameDay(timer.at, now) ? formatClock(timer.at) : formatDue(timer.at)
  return `in ${formatLeft(timer.at - now)} · ${at}`
}

type ButtonProps = { timers: TimerEntry[]; now: number }

/** Board button with the count of running timers and of those that went off. */
export function TimerButton({ timers, now }: ButtonProps) {
  const open = useTimerPanelOpen()
  if (timers.length === 0) return null
  const fired = timers.filter((t) => t.state === 'fired').length
  const running = timers.filter((t) => ['running', 'soon', 'watching'].includes(t.state))
  const next = running.find((t) => t.at !== null)
  const title = next
    ? `Next: ${next.note || 'Timer'} · in ${formatLeft(next.at! - now)}`
    : 'Timers on this board'
  return (
    <div className="bg-card rounded-lg border p-1 shadow-md">
      <Button
        variant={open ? 'secondary' : 'ghost'}
        size="sm"
        className="font-normal"
        aria-label={`Timers: ${running.length} running, ${fired} gone off`}
        aria-pressed={open}
        title={title}
        data-tour="timer-list"
        onClick={() => setTimerPanelOpen(!open)}
      >
        <AlarmClock strokeWidth={1.75} />
        <span className="tabular-nums">{running.length}</span>
        {fired > 0 && (
          <span
            className="timer-cube flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums"
            data-state="fired"
          >
            {fired}
          </span>
        )}
      </Button>
    </div>
  )
}

type PanelProps = {
  timers: TimerEntry[]
  now: number
  onOpen: (id: string) => void
  onDone: (id: string) => void
  onSnooze: (id: string, ms: number) => void
}

/** Every timer of the board; stays open while the user jumps between timers. */
export function TimerPanel({ timers, now, onOpen, onDone, onSnooze }: PanelProps) {
  const open = useTimerPanelOpen()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      // Esc closes a timer's popover first, the panel on the next press.
      if (event.key !== 'Escape' || document.querySelector('[data-radix-popper-content-wrapper]'))
        return
      setTimerPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const groups = groupTimers(timers, now)
  return (
    <section
      role="dialog"
      aria-label="Timers"
      className="bg-card absolute top-16 right-4 z-10 flex max-h-[calc(100dvh-8rem)] w-80 flex-col rounded-lg border shadow-md"
    >
      <header className="flex items-center gap-2 border-b py-1 pr-1 pl-3">
        <h2 className="flex-1 text-[14px] font-medium">Timers</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Close"
          onClick={() => setTimerPanelOpen(false)}
        >
          <X strokeWidth={1.75} />
        </Button>
      </header>
      <div className="flex flex-col gap-2 overflow-y-auto p-2">
        {groups.length === 0 && (
          <p className="text-muted-foreground px-1 py-2 text-[13px]">
            No timers on this board. Pick the Timer tool (R) and click an element.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.title} aria-label={group.title} className="flex flex-col">
            <h3 className="text-muted-foreground px-1 pb-1 text-[12px] font-medium">
              {group.title}
            </h3>
            <ul className="flex flex-col">
              {group.timers.map((timer) => {
                const Icon = ICONS[timer.state]
                return (
                  <li key={timer.id} className="hover:bg-accent group/row rounded-md">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-1 py-1.5 text-left"
                      onClick={() => onOpen(timer.id)}
                    >
                      <span
                        className="timer-cube flex size-6 shrink-0 items-center justify-center rounded-md"
                        data-state={timer.state}
                      >
                        <Icon className="size-3.5" strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate text-[13px]',
                            timer.state === 'done' && 'text-muted-foreground',
                          )}
                        >
                          {timer.note || 'Timer'}
                        </span>
                        <span className="text-muted-foreground block truncate text-[12px] tabular-nums">
                          {[when(timer, now), timer.holder && `on ${timer.holder}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                    {timer.state === 'fired' && (
                      <div className="flex gap-1 pb-1.5 pl-9">
                        <Button size="xs" onClick={() => onDone(timer.id)}>
                          Done
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => onSnooze(timer.id, SNOOZES[0].ms)}
                        >
                          {SNOOZES[0].label}
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
