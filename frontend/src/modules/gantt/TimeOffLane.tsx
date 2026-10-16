import { useQueryClient } from '@tanstack/react-query'
import { useReactFlow } from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import { useRef, useState, type PointerEvent } from 'react'
import { addTimeOff, HUES, removeTimeOff, storePerson, type Person } from '@/api/planning'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { DatesTip } from '@/modules/gantt/GanttBar'
import { LANE_ROW, type PlacedAway } from '@/modules/gantt/timeoff'
import {
  barBox,
  dayAt,
  formatDay,
  formatSpan,
  rangeDays,
  type Span,
} from '@/modules/gantt/timeline'
import { cn } from '@/lib/utils'
import { toastError } from '@/lib/toast'

type Props = {
  items: PlacedAway[]
  height: number
  range: Span
  pxPerDay: number
  people: Person[]
}

// A click without a drag marks one week, as on a row.
const CLICK_DAYS = 7
const MOVE_PX = 3
const TOP = 4
const SHOWN = 8
const HATCH = {
  background: 'repeating-linear-gradient(135deg, var(--card) 0 4px, var(--muted) 4px 8px)',
}

/** Who is away over this Gantt's range; drag across free days to mark someone else away. */
export function TimeOffLane({ items, height, range, pxPerDay, people }: Props) {
  const { getZoom } = useReactFlow()
  const [ghost, setGhost] = useState<Span | null>(null)
  const [asking, setAsking] = useState<Span | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const draw = useRef<{ day: number; x: number; left: number; zoom: number } | null>(null)
  const dayUnder = (clientX: number, left: number, zoom: number) =>
    dayAt((clientX - left) / zoom, range, pxPerDay)

  const startDraw = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.button !== 0) return
    event.stopPropagation()
    const zoom = getZoom()
    const left = event.currentTarget.getBoundingClientRect().left
    const day = dayUnder(event.clientX, left, zoom)
    event.currentTarget.setPointerCapture(event.pointerId)
    draw.current = { day, x: event.clientX, left, zoom }
    setGhost({ start: day, end: day })
  }
  const moveDraw = (event: PointerEvent) => {
    const current = draw.current
    if (!current || Math.abs(event.clientX - current.x) < MOVE_PX) return
    const day = dayUnder(event.clientX, current.left, current.zoom)
    setGhost({ start: Math.min(day, current.day), end: Math.max(day, current.day) })
  }
  const endDraw = (event: PointerEvent) => {
    const current = draw.current
    draw.current = null
    if (!current) return
    const moved = Math.abs(event.clientX - current.x) >= MOVE_PX
    const span = moved
      ? (ghost ?? { start: current.day, end: current.day })
      : { start: current.day, end: Math.min(current.day + CLICK_DAYS - 1, range.end) }
    setGhost(span)
    setAsking(span)
  }
  const stopAsking = () => {
    setAsking(null)
    setGhost(null)
  }
  const ghostBox = ghost && barBox(ghost, range, pxPerDay)

  return (
    <div
      data-gantt-timeoff
      aria-label="Time off"
      className="relative cursor-crosshair border-b"
      style={{ height }}
      onPointerDown={startDraw}
      onPointerMove={moveDraw}
      onPointerUp={endDraw}
      onPointerCancel={() => {
        draw.current = null
        setGhost(null)
      }}
    >
      {items.map((item) => (
        <AwayBar
          key={item.off.id}
          item={item}
          range={range}
          pxPerDay={pxPerDay}
          open={open === item.off.id}
          onOpen={(next) => setOpen(next ? item.off.id : null)}
        />
      ))}
      {ghostBox && (
        <Popover open={asking !== null} onOpenChange={(next) => !next && stopAsking()}>
          <PopoverAnchor asChild>
            <div
              aria-hidden
              className="border-primary bg-accent pointer-events-none absolute h-5 rounded-[4px] border border-dashed"
              style={{ top: TOP, left: ghostBox.left, width: Math.max(ghostBox.width, 4) }}
            />
          </PopoverAnchor>
          {asking && (
            <PopoverContent side="bottom" align="start" className="w-64 p-3">
              <WhoIsAway span={asking} people={people} onDone={stopAsking} />
            </PopoverContent>
          )}
        </Popover>
      )}
    </div>
  )
}

function AwayBar({
  item,
  range,
  pxPerDay,
  open,
  onOpen,
}: {
  item: PlacedAway
  range: Span
  pxPerDay: number
  open: boolean
  onOpen: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState(false)
  const box = barBox(item.span, range, pxPerDay)
  if (!box) return null
  const { person, off } = item
  const remove = async () => {
    setRemoving(true)
    try {
      storePerson(queryClient, await removeTimeOff(person.id, off.id))
      onOpen(false)
    } catch (error) {
      toastError(error as Error)
    } finally {
      setRemoving(false)
    }
  }

  return (
    // Its own box for `peer-hover`, as each stage has.
    <div className="contents">
      <Popover open={open} onOpenChange={onOpen}>
        <PopoverAnchor asChild>
          <button
            type="button"
            aria-label={`${person.name} is away ${formatSpan(item.span)}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onOpen(!open)}
            className={cn(
              'peer border-muted-foreground text-foreground absolute flex h-5 items-center overflow-hidden rounded-[4px] border border-dashed px-1.5 text-[11px] leading-5 font-medium whitespace-nowrap',
              box.clippedStart && 'rounded-l-none',
              box.clippedEnd && 'rounded-r-none',
            )}
            style={{
              top: TOP + item.lane * LANE_ROW,
              left: box.left,
              width: Math.max(box.width, 4),
              ...HATCH,
            }}
          >
            <Initial person={person} />
            <span className={cn('truncate', person.archived && 'opacity-60')}>{person.name}</span>
          </button>
        </PopoverAnchor>
        <DatesTip
          span={item.span}
          note={`${person.name} · time off`}
          shown={false}
          left={box.left}
          right={box.left + box.width}
          width={rangeDays(range.start, range.end) * pxPerDay}
        />
        <PopoverContent side="bottom" align="start" className="w-64 p-3">
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="font-semibold">{person.name} is away</div>
            <div className="text-muted-foreground text-[12px] tabular-nums">
              {formatSpan(item.span)}
            </div>
            <p className="text-muted-foreground text-[12px]">
              Time off belongs to the person, so it shows on every board where they have a stage.
              Only the dates are kept.
            </p>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                disabled={removing}
                className="text-destructive hover:text-destructive"
                onClick={remove}
              >
                <Trash2 className="size-3.5" />
                Remove time off
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** A round initial in a hue of its own, so ranges of one person read together across lanes. */
function Initial({ person }: { person: Person }) {
  const hue = HUES[[...person.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % HUES.length]
  return (
    <span
      aria-hidden
      className="mr-1 inline-grid size-3.5 shrink-0 place-items-center rounded-full text-[8px] leading-none font-semibold text-white"
      style={{ background: `oklch(0.58 0.13 ${hue})` }}
    >
      {person.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** The people list for a range drawn on the lane; a pick marks that person away. */
function WhoIsAway({ span, people, onDone }: { span: Span; people: Person[]; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const q = query.trim().toLocaleLowerCase()
  const matches = people
    .filter((p) => !p.archived && p.name.toLocaleLowerCase().includes(q))
    .slice(0, SHOWN)
  const pick = async (person: Person) => {
    if (saving) return
    setSaving(true)
    try {
      const saved = await addTimeOff(person.id, {
        start: formatDay(span.start),
        end: formatDay(span.end),
      })
      storePerson(queryClient, saved)
      onDone()
    } catch (error) {
      toastError(error as Error)
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="font-semibold">Who is away?</div>
      <div className="text-muted-foreground text-[12px] tabular-nums">{formatSpan(span)}</div>
      <Input
        autoFocus
        aria-label="Find a person"
        placeholder="Find a person"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && matches[0]) void pick(matches[0])
        }}
        className="h-8"
      />
      <div role="listbox" aria-label="People" className="flex flex-col">
        {matches.map((person) => (
          <button
            key={person.id}
            type="button"
            role="option"
            aria-selected={false}
            disabled={saving}
            onClick={() => void pick(person)}
            className="hover:bg-accent flex items-baseline gap-2 rounded-[4px] px-2 py-1 text-left"
          >
            {person.name}
            {person.teams.length > 0 && (
              <span className="text-muted-foreground truncate text-[12px]">
                {person.teams.join(', ')}
              </span>
            )}
          </button>
        ))}
        {matches.length === 0 && (
          <p className="text-muted-foreground px-2 py-1 text-[12px]">
            Nobody by that name. Add people in Settings → Planning.
          </p>
        )}
      </div>
    </div>
  )
}
