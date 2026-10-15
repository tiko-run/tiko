import {
  Bell,
  CirclePause,
  Coffee,
  Pause,
  Play,
  SkipForward,
  SlidersHorizontal,
  Target,
  Timer,
} from 'lucide-react'
import { useEffect, type CSSProperties } from 'react'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { askNotify, primeAudio } from './alerts'
import { FocusSettings } from './FocusSettings'
import * as music from './music'
import { updateTimer, useFocus } from './store'
import { describe, formatClock, pause, play, view, type Mode } from './timer'
import { tone } from './tone'

const ICONS: Record<Mode, typeof Timer> = {
  idle: Timer,
  focus: Target,
  break: Coffee,
  paused: CirclePause,
  done: Bell,
  rested: Bell,
}

const DECK_BUTTON =
  'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground grid size-[26px] shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

export function FocusCapsule() {
  const { settings, timer, now } = useFocus()
  const v = view(timer, settings, now)
  const t = tone(v.mode, v.progress)
  const label = describe(timer, settings, v.mode)
  const Icon = ICONS[v.mode]
  const running = timer.status === 'running'
  const player = music.useMusic()
  const track = player.tracks[player.index]

  useEffect(() => music.followTimer(v.mode), [v.mode])

  function onPlay() {
    if (running) {
      updateTimer((state, _, at) => pause(state, at))
      return
    }
    primeAudio()
    if (settings.notify) void askNotify()
    updateTimer((state, s, at) => play(state, s, at))
  }

  const dialStyle = {
    '--focus-h': t.hue.toFixed(1),
    '--focus-h2': t.hue2.toFixed(1),
    '--focus-c': t.chroma.toFixed(4),
  } as CSSProperties

  return (
    <Popover>
      <PopoverAnchor asChild>
        <section
          aria-label="Focus timer"
          data-tour="focus"
          className="focus-capsule bg-card absolute top-4 left-1/2 z-10 w-[264px] -translate-x-1/2 rounded-t-[26px] rounded-b-xl border shadow-md"
        >
          <div
            className="focus-dial grid h-14 grid-cols-[36px_1fr_36px] items-center gap-1.5 rounded-t-[25px] px-2.5"
            data-mode={v.mode}
            style={dialStyle}
          >
            <span
              tabIndex={0}
              role="img"
              aria-label={label}
              className="group relative grid size-8 place-items-center rounded-full bg-(--focus-tint) outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
              <span className="bg-foreground/80 text-background pointer-events-none absolute top-full left-1/2 z-20 mt-1.5 -translate-x-1/2 rounded px-1.5 py-1 text-[11px] font-semibold whitespace-nowrap opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100">
                {label}
              </span>
            </span>
            <div className="flex flex-col items-center gap-[3px]">
              <span
                className="font-mono text-[28px] leading-none font-medium tracking-[-0.02em] tabular-nums"
                role="timer"
                aria-label={`${formatClock(v.remaining)} left`}
              >
                {formatClock(v.remaining)}
              </span>
              <span className="flex gap-1" aria-hidden>
                {Array.from({ length: settings.rounds }, (_, i) => (
                  <i
                    key={i}
                    className={
                      'size-1.5 rounded-full border-[1.25px] ' +
                      (i < v.done
                        ? 'border-(--focus-ink) bg-(--focus-ink)'
                        : i === v.done && v.mode !== 'idle'
                          ? 'border-(--focus-ink)'
                          : 'border-(--focus-ink-soft)')
                    }
                  />
                ))}
              </span>
            </div>
            <button
              type="button"
              onClick={onPlay}
              aria-label={running ? 'Pause' : 'Start'}
              data-tour="focus-start"
              className="grid size-[34px] place-items-center justify-self-end rounded-full bg-(--focus-ink) text-(--focus-fill) transition-opacity outline-none hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {running ? (
                <Pause className="size-4" fill="currentColor" strokeWidth={0} />
              ) : (
                <Play className="ml-0.5 size-4" fill="currentColor" strokeWidth={0} />
              )}
            </button>
          </div>
          <div className="flex h-9 items-center gap-0.5 pr-1.5 pl-3.5">
            <span
              aria-hidden
              data-playing={player.playing || undefined}
              className="focus-eq text-muted-foreground data-playing:text-foreground flex h-[11px] w-[13px] shrink-0 items-end gap-0.5"
            >
              <i />
              <i />
              <i />
            </span>
            <span className="ml-1.5 min-w-0 flex-1 truncate text-[12px]">
              {track.title} <span className="text-muted-foreground">· {track.author}</span>
            </span>
            <button
              type="button"
              onClick={music.toggle}
              aria-label={player.playing ? 'Pause music' : 'Play music'}
              className={DECK_BUTTON}
            >
              {player.playing ? (
                <Pause className="size-3.5" fill="currentColor" strokeWidth={0} />
              ) : (
                <Play className="size-3.5" fill="currentColor" strokeWidth={0} />
              )}
            </button>
            <button
              type="button"
              onClick={music.next}
              aria-label="Next track"
              className={DECK_BUTTON}
            >
              <SkipForward className="size-3.5" strokeWidth={1.75} />
            </button>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Focus settings" className={DECK_BUTTON}>
                <SlidersHorizontal className="size-[15px]" strokeWidth={1.75} />
              </button>
            </PopoverTrigger>
          </div>
        </section>
      </PopoverAnchor>
      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={8}
        className="w-[300px] p-3 duration-200 ease-out data-closed:duration-100"
      >
        <FocusSettings />
      </PopoverContent>
    </Popover>
  )
}
