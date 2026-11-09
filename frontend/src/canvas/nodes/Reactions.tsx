import { useOnViewportChange } from '@xyflow/react'
import { SmilePlus, UserRound } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { stickerUrl } from '@/api/stickers'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { REACTIONS, reactionsOf, reactors, useReactions, type ReactionId } from '@/canvas/reactions'
import { Avatar } from '@/live/Avatar'
import { colorOf } from '@/live/presence'
import { cn } from '@/lib/utils'

// Names shown on hover before "and N more".
const SHOWN = 5
// The pointer may cross from a chip to its list of names in this long.
const LEAVE_MS = 150
const OPEN_MS = 300
// Keeps a press on a chip from selecting or dragging the element under it.
const OWN_POINTER = 'nodrag nopan nowheel'

function Emoji({ id, size }: { id: ReactionId; size: number }) {
  const { source } = useReactions()
  const { code, label } = REACTIONS.find((r) => r.id === id)!
  return (
    <img
      src={stickerUrl(code, 96, false, source)}
      alt={label}
      draggable={false}
      className="shrink-0"
      style={{ width: size, height: size }}
    />
  )
}

/** The six emoji to pick from. */
export function ReactionPicker({ onPick }: { onPick: (id: ReactionId) => void }) {
  return (
    <div className="flex gap-0.5">
      {REACTIONS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          title={label}
          className="hover:bg-accent rounded-md p-1 transition-transform hover:scale-110"
          onClick={() => onPick(id)}
        >
          <Emoji id={id} size={22} />
        </button>
      ))}
    </div>
  )
}

/** Reactions along the bottom edge of a sticky or a card, with a button to add one. */
export function Reactions({ id, data }: { id: string; data: Record<string, unknown> }) {
  const { me, react } = useReactions()
  const [picking, setPicking] = useState(false)
  useOnViewportChange({ onStart: () => setPicking(false) })
  const given = reactionsOf(data)
  if (!given.length && !react) return null
  return (
    <div
      className={cn(
        OWN_POINTER,
        // Straddles the bottom edge by half a chip; more rows grow downwards.
        'reactions absolute top-full left-2 z-10 flex w-max -translate-y-3 flex-wrap gap-1',
        picking && 'picking',
      )}
      // As wide as the element, so many reactions wrap; a narrow card still fits a few in a row.
      style={{ maxWidth: 'max(calc(100% - 1rem), 12rem)' }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {given.map(({ id: emoji, people }) => (
        <Chip
          key={emoji}
          emoji={emoji}
          people={people}
          own={me !== undefined && people.includes(me)}
          onToggle={react && (() => react([id], emoji))}
        />
      ))}
      {react && (
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Add reaction"
              title="Add reaction"
              className="reaction-add bg-card text-muted-foreground hover:text-foreground flex h-6 items-center rounded-full border px-1.5 shadow-xs"
            >
              <SmilePlus className="size-4" strokeWidth={1.75} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="start"
            className={cn(OWN_POINTER, 'w-auto p-1')}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <ReactionPicker
              onPick={(emoji) => {
                setPicking(false)
                react([id], emoji)
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

function Chip({
  emoji,
  people,
  own,
  onToggle,
}: {
  emoji: ReactionId
  people: string[]
  own: boolean
  onToggle?: () => void
}) {
  const { label } = REACTIONS.find((r) => r.id === emoji)!
  const chip = (
    <button
      type="button"
      aria-label={`${label}: ${people.length}`}
      aria-pressed={onToggle ? own : undefined}
      // Not disabled: a viewer still hovers it for the names.
      aria-disabled={!onToggle}
      onClick={onToggle}
      className={cn(
        'bg-card flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs tabular-nums shadow-xs',
        onToggle ? 'hover:border-primary/60' : 'cursor-default',
        own && 'border-primary bg-primary/10 text-primary font-medium',
      )}
    >
      <Emoji id={emoji} size={16} />
      {people.length}
    </button>
  )
  return (
    <WhoReacted emoji={emoji} people={people}>
      {chip}
    </WhoReacted>
  )
}

/** Who put a reaction, on hover; "and N more" opens the whole list until Escape or a click away. */
function WhoReacted({
  emoji,
  people,
  children,
}: {
  emoji: ReactionId
  people: string[]
  children: ReactNode
}) {
  const { me, names } = useReactions()
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const timer = useRef(0)
  useOnViewportChange({ onStart: () => setOpen(false) })
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // A guest of a public link sees counts only.
  if (!names) return children

  const later = (next: boolean, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(next), ms)
  }
  const enter = () => later(true, open ? 0 : OPEN_MS)
  // The whole list stays until it is closed on purpose.
  const leave = () => (all ? window.clearTimeout(timer.current) : later(false, LEAVE_MS))
  const listed = reactors(people, me, names)
  const shown = all ? listed : listed.slice(0, SHOWN)
  const more = listed.length - shown.length
  const { label } = REACTIONS.find((r) => r.id === emoji)!

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setAll(false)
      }}
    >
      {/* An anchor, not a trigger: a click on the chip reacts and leaves the names alone. */}
      <PopoverAnchor asChild onPointerEnter={enter} onPointerLeave={leave}>
        {children}
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className={cn(OWN_POINTER, 'w-auto max-w-56 min-w-40 gap-0 p-1 text-xs')}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={() => window.clearTimeout(timer.current)}
        onPointerLeave={leave}
      >
        <div className="text-muted-foreground flex items-center gap-1.5 px-1.5 pt-1 pb-1.5">
          <Emoji id={emoji} size={16} />
          <span className="text-foreground font-medium">{label}</span>
          <span className="ml-auto tabular-nums">{people.length}</span>
        </div>
        <ul className={cn('flex flex-col', all && 'max-h-60 overflow-y-auto')} aria-label="Reacted">
          {shown.map((person) => (
            <li key={person.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
              {person.known ? (
                <Avatar
                  user={{
                    id: person.id,
                    name: names.get(person.id) ?? person.name,
                    color: colorOf(person.id),
                  }}
                  className="size-5 text-[9px]"
                />
              ) : (
                <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full">
                  <UserRound className="size-3" strokeWidth={2} />
                </span>
              )}
              <span className={cn('truncate', !person.known && 'text-muted-foreground')}>
                {person.name}
              </span>
            </li>
          ))}
        </ul>
        {more > 0 && (
          <button
            type="button"
            className="text-muted-foreground hover:bg-accent hover:text-foreground mt-0.5 rounded-md px-1.5 py-1 text-left"
            onClick={() => setAll(true)}
          >
            and {more} more
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
