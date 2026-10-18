import { Trash2 } from 'lucide-react'
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { TaskLink } from '@/canvas/tasks-context'
import type { TimerData } from '@/canvas/types'
import { notifyPermission } from '@/focus/alerts'
import { cn } from '@/lib/utils'
import { useNow } from './clock'
import {
  formatDue,
  formatLeftLong,
  parseWhen,
  PRESETS,
  suggestionNote,
  suggestWhen,
  WHEN_HINT,
} from './time'
import {
  DEFAULT_MS,
  describeWatch,
  finish,
  goesOffAt,
  REPEATS,
  setDue,
  setRepeat,
  snooze,
  SNOOZES,
  timerState,
  watchStatus,
} from './timer'

type Props = {
  data: TimerData
  /** The element the timer is attached to, as the timer names it. */
  holder?: string
  /** The task card the timer is attached to and its current status, when it is loaded. */
  task?: TaskLink & { status: string }
  onChange: (data: TimerData) => void
  onDelete: () => void
}

type Choice<T> = { value: T; label: string }

function Segmented<T>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Choice<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="bg-muted flex gap-0.5 rounded-md p-0.5">
      {options.map((option) => (
        <Button
          key={option.label}
          type="button"
          size="xs"
          variant={option.value === value ? 'outline' : 'ghost'}
          aria-pressed={option.value === value}
          className={cn('flex-1 font-normal', option.value === value && 'bg-card shadow-xs')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

const MODES: Choice<'time' | 'status'>[] = [
  { value: 'time', label: 'At a time' },
  { value: 'status', label: 'When the status changes' },
]

/** Popover content of a timer: what it waits for and when it goes off. */
export function TimerEditor({ data, holder, task, onChange, onDelete }: Props) {
  const now = useNow()
  const id = useId()
  const [input, setInput] = useState('')
  const state = timerState(data, now)
  const at = goesOffAt(data)
  const typed = parseWhen(input, now)
  const suggestions = suggestWhen(input, now)
  // Half-typed input that can still become a time is not an error yet.
  const unfinished = typed !== null && 'error' in typed && suggestions.length > 0
  const blocked = ['denied', 'unsupported'].includes(notifyPermission())

  const apply = (text: string) => {
    const when = parseWhen(text, now)
    if (!when || 'error' in when) return
    onChange(setDue(data, when.at))
    setInput('')
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    apply(input)
  }
  const complete = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || event.shiftKey || suggestions.length === 0) return
    event.preventDefault()
    setInput(suggestions[0].input)
  }

  const watch = data.watch
  const repeat = REPEATS.find((r) => r.value === data.repeat)!
  const series = data.repeat ? ` · ${repeat.label}` : ''
  const line = watch
    ? state === 'fired'
      ? `${describeWatch(watch)}.`
      : state === 'done'
        ? `Done. ${describeWatch(watch)}.`
        : `Goes off ${describeWatch(watch)}.`
    : typed
      ? 'error' in typed
        ? unfinished
          ? 'Keep typing or pick a suggestion. Tab takes the first one.'
          : typed.error
        : `Goes off ${formatDue(typed.at)} · in ${formatLeftLong(typed.at - now)}. Press Enter to set.`
      : at === null
        ? 'Waiting.'
        : state === 'fired'
          ? `Went off ${formatDue(at)}${series}.`
          : state === 'done'
            ? `Done. Was set for ${formatDue(at)}.`
            : `Goes off ${formatDue(at)} · in ${formatLeftLong(at - now)}${series}.`

  const setMode = (mode: 'time' | 'status') => {
    if (mode === 'status' && task) onChange(watchStatus(data, task, task.status))
    if (mode === 'time' && watch) onChange(setDue(data, now + DEFAULT_MS))
  }

  return (
    <div className="flex flex-col gap-2.5">
      {holder && <p className="text-muted-foreground text-[12px]">Attached to {holder}</p>}
      <Textarea
        value={data.note}
        onChange={(event) => onChange({ ...data, note: event.target.value })}
        placeholder="What are you waiting for?"
        aria-label="Note"
        maxLength={500}
        rows={2}
        autoFocus
        className="min-h-0 resize-none text-[14px] md:text-[14px]"
      />
      {(task || watch) && (
        <Segmented
          label="Goes off"
          options={MODES}
          value={watch ? 'status' : 'time'}
          onChange={setMode}
        />
      )}
      {!watch && (
        <form onSubmit={submit} className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-muted-foreground text-[13px]">
            Goes off in or at
          </label>
          <Input
            id={id}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={complete}
            placeholder={WHEN_HINT}
            autoComplete="off"
            spellCheck={false}
          />
          {suggestions.length > 0 ? (
            <div role="group" aria-label="Suggestions" className="flex flex-wrap gap-1">
              {suggestions.map((suggestion) => (
                <Button
                  key={suggestion.input}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => apply(suggestion.input)}
                >
                  {suggestion.input}
                  {suggestionNote(suggestion, now) && (
                    <span className="text-muted-foreground font-normal">
                      {suggestionNote(suggestion, now)}
                    </span>
                  )}
                </Button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => apply(preset.input)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          )}
          <Segmented
            label="Repeat"
            options={REPEATS}
            value={data.repeat}
            onChange={(value) => onChange(setRepeat(data, value))}
          />
        </form>
      )}
      <p
        role="status"
        className={cn(
          'text-[13px]',
          typed && 'error' in typed && !unfinished ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {line}
      </p>
      {blocked && (
        <p className="text-muted-foreground text-[12px]">
          Notifications are off for this site, so only the board shows a timer that goes off.
        </p>
      )}
      <div className="flex items-center gap-1 border-t pt-2">
        {state === 'fired' && (
          <>
            <Button size="sm" onClick={() => onChange(finish(data, now))}>
              Done
            </Button>
            {SNOOZES.map(({ label, ms }) => (
              <Button
                key={label}
                size="sm"
                variant="ghost"
                onClick={() => onChange(snooze(data, ms, now))}
              >
                {label}
              </Button>
            ))}
          </>
        )}
        {(state === 'running' || state === 'soon' || state === 'watching') && (
          <Button size="sm" variant="ghost" onClick={() => onChange(finish(data, now))}>
            {data.repeat && !watch ? 'Skip to the next time' : 'Mark done'}
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Delete timer"
          title="Delete timer"
          className="text-muted-foreground ml-auto"
          onClick={onDelete}
        >
          <Trash2 strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  )
}
