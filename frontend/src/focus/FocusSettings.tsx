import { Minus, Plus, RotateCcw, SkipForward, Volume1, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { askNotify, notifyPermission, type NotifyPermission } from './alerts'
import type * as library from './library'
import * as music from './music'
import { updateSettings, updateTimer, useFocus } from './store'
import { LIMITS, reset, skip, type TimerSettings } from './timer'
import { Scroller } from '@/components/Scroller'

type Length = keyof typeof LIMITS

function Stepper({ field, label, unit }: { field: Length; label: string; unit?: string }) {
  const { settings } = useFocus()
  const value = settings[field]
  const [min, max] = LIMITS[field]
  const id = useId()
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <span id={id}>{label}</span>
      <div role="group" aria-labelledby={id} className="flex h-7 items-center rounded-md border">
        <button
          type="button"
          aria-label={`Less ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => updateSettings({ [field]: value - 1 })}
          className="text-muted-foreground hover:bg-muted hover:text-foreground grid h-full w-6 place-items-center rounded-l-md disabled:opacity-40"
        >
          <Minus className="size-3" strokeWidth={1.75} />
        </button>
        <span className="w-14 text-center font-mono text-[12px] tabular-nums" aria-live="polite">
          {value}
          {unit && ` ${unit}`}
        </span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => updateSettings({ [field]: value + 1 })}
          className="text-muted-foreground hover:bg-muted hover:text-foreground grid h-full w-6 place-items-center rounded-r-md disabled:opacity-40"
        >
          <Plus className="size-3" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <label htmlFor={id}>{label}</label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      {hint && <p className="text-muted-foreground text-[12px]">{hint}</p>}
    </div>
  )
}

const BLOCKED: Partial<Record<NotifyPermission, string>> = {
  denied: 'Notifications are blocked for this site in the browser settings.',
  unsupported: 'This browser does not show notifications.',
}

function TimerTab() {
  const { settings } = useFocus()
  const [permission, setPermission] = useState(notifyPermission)
  const set = (patch: Partial<TimerSettings>) => updateSettings(patch)

  async function toggleNotify(on: boolean) {
    set({ notify: on })
    if (on) setPermission(await askNotify())
  }

  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => updateTimer((timer, s) => skip(timer, s))}
        >
          <SkipForward strokeWidth={1.75} />
          Skip phase
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => updateTimer((_, s) => reset(s))}
        >
          <RotateCcw strokeWidth={1.75} />
          Reset cycle
        </Button>
      </div>
      <div className="bg-border h-px" />
      <Stepper field="focus" label="Focus" unit="min" />
      <Stepper field="short" label="Short break" unit="min" />
      <Stepper field="long" label="Long break" unit="min" />
      <Stepper field="rounds" label="Rounds before long break" />
      <div className="bg-border h-px" />
      <Toggle
        label="Sound at the end"
        checked={settings.sound}
        onChange={(sound) => set({ sound })}
      />
      <Toggle
        label="Browser notification"
        checked={settings.notify}
        onChange={toggleNotify}
        hint={settings.notify ? BLOCKED[permission] : undefined}
      />
      <Toggle
        label="Start the next phase on its own"
        checked={settings.autoStart}
        onChange={(autoStart) => set({ autoStart })}
      />
    </div>
  )
}

const PROTECTION: Record<library.Protection, string> = {
  protected: 'Protected from automatic cleanup.',
  unprotected: 'The browser may clear them when disk space runs low.',
  unavailable: 'Open tiko over HTTPS or on localhost to protect them from cleanup.',
}

function MusicTab() {
  const player = music.useMusic()
  const files = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLOListElement>(null)

  // A track added at the end of a long list is the current one, so keep it in view.
  useEffect(() => {
    list.current?.querySelector('[aria-current]')?.scrollIntoView?.({ block: 'nearest' })
  }, [player.index, player.tracks.length])
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <Scroller className="-mx-1" viewportClassName="max-h-[196px]">
        <ol ref={list} className="flex flex-col gap-px" aria-label="Tracks">
          {player.tracks.map((track, i) => (
            <li key={music.trackKey(track)} className="group/track relative">
              <button
                type="button"
                aria-current={i === player.index || undefined}
                onClick={() => music.pick(i)}
                className="hover:bg-muted aria-current:bg-muted flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] aria-current:font-semibold"
              >
                <span className="text-muted-foreground w-4 font-mono tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  {track.title}{' '}
                  <span className="text-muted-foreground font-normal">
                    · {track.author}
                    {track.unsaved && ', this tab only'}
                  </span>
                </span>
                {track.duration !== undefined && (
                  <span className="text-muted-foreground font-mono font-normal tabular-nums">
                    {music.formatDuration(track.duration)}
                  </span>
                )}
              </button>
              {track.id && (
                <button
                  type="button"
                  aria-label={`Remove ${track.title}`}
                  onClick={() => music.removeOwnTrack(track.id!)}
                  className="text-muted-foreground bg-muted hover:text-foreground absolute top-1/2 right-1 grid h-5 w-8 justify-items-end pr-0.5 -translate-y-1/2 place-items-center rounded opacity-0 group-hover/track:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3" strokeWidth={1.75} />
                </button>
              )}
            </li>
          ))}
        </ol>
      </Scroller>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground -mx-1 justify-start"
        onClick={() => files.current?.click()}
      >
        <Plus strokeWidth={1.75} />
        Add your own tracks
      </Button>
      {player.saveError && (
        <p role="alert" className="text-destructive text-[12px] leading-snug">
          {player.saveError}
        </p>
      )}
      {player.storage && (
        <p className="text-muted-foreground text-[12px] leading-snug">
          Your files: {music.formatBytes(player.storage.bytes)} in this browser.{' '}
          {PROTECTION[player.storage.protection]}
        </p>
      )}
      <input
        ref={files}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void music.addFiles(event.target.files)
          event.target.value = ''
        }}
      />
      <div className="bg-border h-px" />
      <label className="text-muted-foreground flex items-center gap-2">
        <Volume1 className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="sr-only">Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(player.volume * 100)}
          onChange={(event) => music.setVolume(Number(event.target.value) / 100)}
          className="accent-muted-foreground h-4 flex-1"
        />
      </label>
      <Toggle
        label="Pause music on breaks"
        checked={player.pauseOnBreaks}
        onChange={music.setPauseOnBreaks}
      />
      <p className="text-muted-foreground text-[11px]">
        Tracks by HoliznaCC0 and omfgdude, CC0, via OpenGameArt. Your own files stay in this browser
        and are never uploaded.
      </p>
    </div>
  )
}

const TABS = [
  { id: 'timer', label: 'Timer', Panel: TimerTab },
  { id: 'music', label: 'Music', Panel: MusicTab },
] as const

export function FocusSettings() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('timer')
  const id = useId()
  const { Panel } = TABS.find((t) => t.id === tab)!
  return (
    <div className="flex flex-col gap-2.5">
      <div role="tablist" className="bg-muted flex gap-0.5 rounded-md p-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${id}-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${id}-panel`}
            onClick={() => setTab(t.id)}
            className="text-muted-foreground aria-selected:bg-card aria-selected:text-foreground flex-1 rounded px-2 py-0.5 text-[12px] aria-selected:shadow-xs"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        <Panel />
      </div>
    </div>
  )
}
