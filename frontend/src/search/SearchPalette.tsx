import {
  AlarmClock,
  Diamond,
  Frame,
  LayoutTemplate,
  Rows3,
  Search,
  Shapes,
  StickyNote,
  Type,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { TypeIcon } from '@/canvas/nodes/TaskBits'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { formatShortcut, SHORTCUTS } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'
import { findModule } from '@/modules/registry'
import type { Command } from './commands'
import type { Entry } from './index'
import { highlight, snippet, type Range } from './match'
import { dropLastToken, FIELD_TITLES, filterText, MARKERS, type Filter } from './query'
import { suggestionsFor, taskFacets, viewFor, type View } from './view'

const ICONS: Record<Exclude<Entry['kind'], 'card' | 'module'>, LucideIcon> = {
  sticky: StickyNote,
  shape: Shapes,
  text: Type,
  frame: Frame,
  timer: AlarmClock,
  row: Rows3,
  milestone: Diamond,
}

function EntryIcon({ entry }: { entry: Entry }) {
  if (entry.kind === 'card' || entry.typeName) return <TypeIcon typeName={entry.typeName ?? ''} />
  const Icon =
    entry.kind === 'module'
      ? (findModule(entry.module ?? '')?.Icon ?? LayoutTemplate)
      : ICONS[entry.kind]
  return <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
}

function Marked({ text, ranges }: { text: string; ranges: Range[] }) {
  if (ranges.length === 0) return text
  const parts = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <mark key={start} className="bg-primary/15 text-foreground rounded-[2px]">
        {text.slice(start, end)}
      </mark>,
    )
    at = end
  }
  parts.push(text.slice(at))
  return parts
}

function Row({ entry, query }: { entry: Entry; query: string[] }) {
  const text = snippet(entry.text, query)
  return (
    <>
      <EntryIcon entry={entry} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
        {entry.label && (
          <span className="text-primary shrink-0 font-mono text-[12px]">
            <Marked text={entry.label} ranges={highlight(entry.label, query)} />
          </span>
        )}
        <span className="truncate">
          <Marked text={text.text} ranges={text.ranges} />
        </span>
      </span>
      {entry.context && (
        <span className="text-muted-foreground max-w-[45%] shrink-0 truncate text-[12px]">
          {entry.context}
        </span>
      )}
    </>
  )
}

function Option({
  id,
  at,
  active,
  onHover,
  onPick,
  children,
}: {
  id: string
  at: number
  active: boolean
  onHover: (at: number) => void
  onPick: () => void
  children: ReactNode
}) {
  return (
    <div
      id={id}
      data-index={at}
      role="option"
      aria-selected={active}
      className={cn(
        'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[14px]',
        active && 'bg-accent',
      )}
      // Keeps focus in the input, so typing goes on after a click elsewhere in the list.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => onHover(at)}
      onClick={onPick}
    >
      {children}
    </div>
  )
}

const rowsOf = (view: View): (Entry | Command)[] => [
  ...view.groups.flatMap((group) => group.entries),
  ...view.commands,
]

const isCommand = (item: Entry | Command): item is Command => 'run' in item

function CommandRow({ command, query }: { command: Command; query: string[] }) {
  const { Icon } = command
  return (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="flex-1 truncate">
        <Marked text={command.title} ranges={highlight(command.title, query)} />
      </span>
      {command.shortcut && (
        <span className="flex shrink-0 gap-1">
          {formatShortcut(command.shortcut)[0].map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      )}
    </>
  )
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  index: Entry[]
  recent: string[]
  /** What the input holds when the palette opens. */
  initialText?: string
  onChoose: (entry: Entry) => void
  /** App commands and boards the palette offers next to the board's elements. */
  commands?: readonly Command[]
  onRun?: (command: Command) => void
  /** The row picked with the keyboard, after a short rest: the board looks at it. */
  onPreview?: (entry: Entry) => void
  /** Nodes of every match of the current query, lit on the board. */
  onTargets?: (ids: string[]) => void
  onSelectAll?: (ids: string[]) => void
}

// Holding an arrow key skims rows; the board moves only once the pick rests.
const PREVIEW_DELAY_MS = 120

export function SearchPalette({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        // Radix selects the input's text on open, and the first key would erase a typed `>`.
        onOpenAutoFocus={(event) => event.preventDefault()}
        // The board stays clear behind the palette: matches light up on it and previews move it.
        overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"
        className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 shadow-xl sm:max-w-[560px]"
      >
        <DialogTitle className="sr-only">Search the board</DialogTitle>
        <PaletteBody onClose={() => onOpenChange(false)} {...rest} />
      </DialogContent>
    </Dialog>
  )
}

const lastKeys = (keys: string) => new Set(keys.split(',').map((combo) => combo.trim().at(-1)))
const SEARCH_KEYS = lastKeys(SHORTCUTS.search.keys)
const COMMAND_KEYS = lastKeys(SHORTCUTS.commands.keys)

function PaletteBody({
  index,
  recent,
  initialText = '',
  onChoose,
  commands = [],
  onRun,
  onPreview,
  onTargets,
  onSelectAll,
  onClose,
}: Omit<Props, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [text, setText] = useState(initialText)
  const [chips, setChips] = useState<Filter[]>([])
  const [active, setActive] = useState(0)
  const deferred = useDeferredValue(text)
  const view = useMemo(
    () => viewFor(index, deferred, recent, chips, commands),
    [index, deferred, recent, chips, commands],
  )
  const facets = useMemo(() => taskFacets(index, chips), [index, chips])
  // From the live text, not the deferred one: Tab right after typing must find them.
  const suggestions = useMemo(() => suggestionsFor(facets, text), [facets, text])
  const rows = useMemo(() => (suggestions ? [] : rowsOf(view)), [view, suggestions])
  const commandGroups = (['Commands', 'Boards'] as const)
    .map((title) => ({ title, commands: view.commands.filter((c) => c.group === title) }))
    .filter((group) => group.commands.length > 0)
  const count = suggestions ? suggestions.values.length : rows.length
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-${i}`
  const current = Math.min(active, count - 1)
  const row = suggestions ? undefined : rows[current]
  const picked = row && !isCommand(row) ? row : undefined
  // True once the pick moved by keyboard since the last keystroke in the input.
  const browsing = useRef(false)

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  useEffect(() => {
    if (!browsing.current || !picked) return
    const timer = setTimeout(() => onPreview?.(picked), PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [picked, onPreview])

  useEffect(() => onTargets?.(view.targets), [view.targets, onTargets])

  const edit = (next: string) => {
    setText(next)
    setActive(0)
    browsing.current = false
  }

  // The typed filter at the end of the input becomes a chip with the picked value.
  const pickValue = (value: string) => {
    if (!suggestions) return
    setChips([...chips, { field: suggestions.field, value }])
    edit(dropLastToken(text))
    input.current?.focus()
  }

  const removeChip = (at: number) => {
    setChips(chips.filter((_, i) => i !== at))
    input.current?.focus()
  }

  const choose = (item: Entry | Command) => (isCommand(item) ? onRun?.(item) : onChoose(item))

  // Keys right after typing must act on what was typed, not on the deferred list.
  const freshView = () => (deferred === text ? view : viewFor(index, text, recent, chips, commands))

  const selectAll = () => {
    const { targets } = freshView()
    if (targets.length) onSelectAll?.(targets)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const mod = event.metaKey || event.ctrlKey
    if (step && count) {
      event.preventDefault()
      browsing.current = true
      setActive((current + step + count) % count)
    } else if (suggestions && (event.key === 'Tab' || event.key === 'Enter')) {
      event.preventDefault()
      const value = suggestions.values[current]?.value
      if (value) pickValue(value)
    } else if (event.key === 'Enter' && mod) {
      event.preventDefault()
      selectAll()
    } else if (event.key === 'Enter' && !suggestions) {
      const fresh = deferred === text ? row : rowsOf(freshView())[0]
      if (!fresh) return
      event.preventDefault()
      choose(fresh)
    } else if (event.key === 'Backspace' && chips.length && !text) {
      // The last chip turns back into text, ready to edit.
      event.preventDefault()
      edit(filterText(chips[chips.length - 1]))
      setChips(chips.slice(0, -1))
    } else if (mod && SEARCH_KEYS.has(event.key.toLowerCase())) {
      // The board shortcuts are off while a dialog is open, so the palette handles its own.
      event.preventDefault()
      onClose()
    } else if (mod && COMMAND_KEYS.has(event.key.toLowerCase())) {
      // Like an editor: the first press narrows to commands, the second one closes.
      event.preventDefault()
      if (text.trimStart().startsWith('>')) onClose()
      else edit(`>${text}`)
    }
  }

  const hover = (at: number) => {
    if (at === current) return
    browsing.current = false
    setActive(at)
  }

  const typed = [...chips.map(filterText), deferred.trim()].filter(Boolean).join(' ')
  let i = 0
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-1">
        <Search aria-hidden className="text-muted-foreground size-4" strokeWidth={1.75} />
        {chips.map((chip, at) => (
          <span
            key={`${chip.field}:${chip.value}:${at}`}
            className="bg-accent text-foreground flex h-6 items-center gap-1 rounded-sm pr-0.5 pl-1.5 text-[13px]"
          >
            <span className="text-muted-foreground">{MARKERS[chip.field]}</span>
            {chip.value}
            <button
              type="button"
              // Tab picks a suggested value in the palette, so it never stops on chips.
              tabIndex={-1}
              aria-label={`Remove ${FIELD_TITLES[chip.field].toLowerCase()} ${chip.value}`}
              className="text-muted-foreground hover:text-foreground rounded-sm p-0.5"
              onClick={() => removeChip(at)}
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          autoFocus
          role="combobox"
          aria-label="Search the board"
          aria-expanded={count > 0}
          aria-controls={listId}
          aria-activedescendant={count ? optionId(current) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            chips.length ? 'Add words or filters…' : 'Search notes, cards, frames, timers…'
          }
          className="placeholder:text-muted-foreground h-10 min-w-40 flex-1 bg-transparent text-[15px] outline-none"
          value={text}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {view.fallback && (
        <p className="text-muted-foreground px-4 pt-2 text-[12px]">
          Showing results for <span className="text-foreground">{view.fallback}</span>
        </p>
      )}
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label={suggestions ? FIELD_TITLES[suggestions.field] : 'Results'}
        className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5 empty:hidden"
      >
        {suggestions && suggestions.values.length > 0 && (
          <div role="group" aria-label={FIELD_TITLES[suggestions.field]}>
            <div className="text-muted-foreground px-2.5 pt-2 pb-1 text-[12px]">
              {FIELD_TITLES[suggestions.field]}
            </div>
            {suggestions.values.map(({ value, count: tasks }, at) => (
              <Option
                key={value}
                id={optionId(at)}
                at={at}
                active={at === current}
                onHover={hover}
                onPick={() => pickValue(value)}
              >
                <span className="text-muted-foreground shrink-0 text-[12px]">
                  {MARKERS[suggestions.field]}
                </span>
                <span className="flex-1 truncate">{value}</span>
                <span className="text-muted-foreground text-[12px] tabular-nums">{tasks}</span>
              </Option>
            ))}
          </div>
        )}
        {!suggestions &&
          view.groups.map((group) => (
            <div key={group.title ?? 'results'} role="group" aria-label={group.title}>
              {group.title && (
                <div className="text-muted-foreground px-2.5 pt-2 pb-1 text-[12px]">
                  {group.title}
                </div>
              )}
              {group.entries.map((entry) => {
                const at = i++
                return (
                  <Option
                    key={`${group.title}:${entry.id}`}
                    id={optionId(at)}
                    at={at}
                    active={at === current}
                    onHover={hover}
                    onPick={() => onChoose(entry)}
                  >
                    <Row entry={entry} query={view.query} />
                  </Option>
                )
              })}
            </div>
          ))}
        {commandGroups.map((group) => (
          <div key={group.title} role="group" aria-label={group.title}>
            <div className="text-muted-foreground px-2.5 pt-2 pb-1 text-[12px]">{group.title}</div>
            {group.commands.map((command) => {
              const at = i++
              return (
                <Option
                  key={command.id}
                  id={optionId(at)}
                  at={at}
                  active={at === current}
                  onHover={hover}
                  onPick={() => choose(command)}
                >
                  <CommandRow command={command} query={view.query} />
                </Option>
              )
            })}
          </div>
        ))}
        {!suggestions && view.more > 0 && (
          <p className="text-muted-foreground px-2.5 py-1.5 text-[12px]">
            {view.more} more. Type more to narrow down.
          </p>
        )}
      </div>
      {count === 0 && (
        <p className="text-muted-foreground px-4 py-6 text-center text-[14px]">
          {suggestions
            ? `No ${FIELD_TITLES[suggestions.field].toLowerCase()} on this board matches.`
            : typed
              ? `Nothing on this board matches "${typed}".`
              : 'Type to find sticky notes, cards, frames, timers and Gantt rows.'}
        </p>
      )}
      {!typed && (
        <p className="text-muted-foreground border-t px-4 py-2 text-[12px]">
          Filter with <code>@name</code>, <code>status:</code>, <code>type:</code>,{' '}
          <code>priority:</code>. Start with <code>#</code> for frames, <code>&gt;</code> for
          commands.
        </p>
      )}
      <div className="text-muted-foreground flex items-center gap-4 border-t px-4 py-2 text-[12px]">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> Move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>{suggestions ? 'Tab' : '↵'}</Kbd> {suggestions ? 'Add filter' : 'Open'}
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> Close
        </span>
        {onSelectAll && view.targets.length > 0 && (
          <button
            type="button"
            className="hover:text-foreground ml-auto flex items-center gap-1 rounded-sm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={selectAll}
          >
            Select all {view.targets.length}
            <Kbd>{formatShortcut('selectMatches')[0].join('')}</Kbd>
          </button>
        )}
      </div>
    </>
  )
}
