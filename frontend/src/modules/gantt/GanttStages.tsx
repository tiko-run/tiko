import { useQueryClient } from '@tanstack/react-query'
import { useReactFlow } from '@xyflow/react'
import { Plus, Trash2, Users } from 'lucide-react'
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from 'react'
import { addStageType, freeHue, storeStageType, type Person, type StageType } from '@/api/planning'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DatesTip } from '@/modules/gantt/GanttBar'
import type { Row } from '@/modules/gantt/rows'
import { StagePeople, stagePeople, type Named } from '@/modules/gantt/StagePeople'
import {
  addStage,
  BARE,
  clampStage,
  gapAt,
  nextType,
  removeStage,
  setStageSpan,
  shownStages,
  stageSpan,
  updateStage,
  type Stage,
} from '@/modules/gantt/stages'
import {
  barBox,
  dayAt,
  dragSpan,
  formatDay,
  formatSpan,
  rangeDays,
  type Grip,
  type Span,
} from '@/modules/gantt/timeline'
import { stageColors } from '@/planning/colors'
import { cn } from '@/lib/utils'
import { toastError } from '@/lib/toast'

type Props = {
  row: Row
  range: Span
  pxPerDay: number
  types: StageType[]
  people: Person[]
  /** Assignees of this Gantt's tasks, offered in the popover until someone adds them. */
  assignees: string[]
  /** Names in a line under each stage instead of after its type. */
  below: boolean
  /** The row's name and, for a task, its live status; the tooltip names both. */
  label: string
  onRow: (row: Row) => void
}

// A click without a drag adds one week.
const CLICK_DAYS = 7
const MOVE_PX = 3
// The bar's `px-1.5` on both sides.
const BAR_PADDING = 12

/** A row cut into stages: drag across free days to add one, drag a stage to move or resize it. */
export function GanttStages({
  row,
  range,
  pxPerDay,
  types,
  people,
  assignees,
  below,
  label,
  onRow,
}: Props) {
  const { getZoom } = useReactFlow()
  const [open, setOpen] = useState<string | null>(null)
  const [ghost, setGhost] = useState<Span | null>(null)
  const draw = useRef<{ day: number; gap: Span; x: number; left: number; zoom: number } | null>(
    null,
  )
  const stages = shownStages(row)
  const dayUnder = (clientX: number, left: number, zoom: number) =>
    dayAt((clientX - left) / zoom, range, pxPerDay)

  const startDraw = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.button !== 0) return
    event.stopPropagation()
    const zoom = getZoom()
    const left = event.currentTarget.getBoundingClientRect().left
    const day = dayUnder(event.clientX, left, zoom)
    const gap = gapAt(row, day)
    if (!gap) return
    event.currentTarget.setPointerCapture(event.pointerId)
    draw.current = { day, gap, x: event.clientX, left, zoom }
    setGhost({ start: day, end: day })
  }
  const moveDraw = (event: PointerEvent) => {
    const current = draw.current
    if (!current || Math.abs(event.clientX - current.x) < MOVE_PX) return
    const day = Math.min(
      Math.max(dayUnder(event.clientX, current.left, current.zoom), current.gap.start),
      current.gap.end,
    )
    setGhost({ start: Math.min(day, current.day), end: Math.max(day, current.day) })
  }
  const endDraw = (event: PointerEvent) => {
    const current = draw.current
    draw.current = null
    setGhost(null)
    if (!current) return
    const moved = Math.abs(event.clientX - current.x) >= MOVE_PX
    const span = moved
      ? (ghost ?? { start: current.day, end: current.day })
      : { start: current.day, end: Math.min(current.day + CLICK_DAYS - 1, current.gap.end) }
    const added = addStage(row, span, nextType(types, row, span.start))
    if (!added) return
    onRow(added.row)
    setOpen(added.id)
  }

  return (
    <div
      data-gantt-stages
      className="absolute inset-0 cursor-crosshair"
      onPointerDown={startDraw}
      onPointerMove={moveDraw}
      onPointerUp={endDraw}
      onPointerCancel={() => {
        draw.current = null
        setGhost(null)
      }}
    >
      {stages.map((stage) => (
        <StageBar
          key={stage.id}
          row={row}
          stage={stage}
          range={range}
          pxPerDay={pxPerDay}
          types={types}
          people={people}
          assignees={assignees}
          below={below}
          label={label}
          open={open === stage.id}
          onOpen={(next) => setOpen(next ? stage.id : null)}
          onRow={onRow}
          onReopen={setOpen}
        />
      ))}
      {ghost && <Ghost span={ghost} range={range} pxPerDay={pxPerDay} />}
    </div>
  )
}

function Ghost({ span, range, pxPerDay }: { span: Span; range: Span; pxPerDay: number }) {
  const box = barBox(span, range, pxPerDay)
  if (!box) return null
  return (
    <div
      aria-hidden
      className="border-primary bg-accent pointer-events-none absolute top-1.5 h-5 rounded-[4px] border border-dashed"
      style={{ left: box.left, width: Math.max(box.width, 4) }}
    />
  )
}

type BarProps = {
  row: Row
  stage: Stage
  range: Span
  pxPerDay: number
  types: StageType[]
  people: Person[]
  assignees: string[]
  below: boolean
  label: string
  open: boolean
  onOpen: (open: boolean) => void
  onRow: (row: Row) => void
  /** Keeps the popover on a stage whose id changed, as the bare bar's does on its first type. */
  onReopen: (id: string) => void
}

function StageBar({
  row,
  stage,
  range,
  pxPerDay,
  types,
  people,
  assignees,
  below,
  label,
  open,
  onOpen,
  onRow,
  onReopen,
}: BarProps) {
  const { getZoom } = useReactFlow()
  const drag = useRef<{ x: number; zoom: number; grip: Grip; span: Span; moved: boolean } | null>(
    null,
  )
  const [dragging, setDragging] = useState(false)
  const measure = useRef<HTMLSpanElement>(null)
  const [crowded, setCrowded] = useState(false)
  const span = stageSpan(stage)
  const box = barBox(span, range, pxPerDay)
  const width = box ? Math.max(box.width, 4) : 0
  const type = types.find((t) => t.id === stage.type)
  const name = stage.type === '' ? 'No stage' : (type?.name ?? 'Unknown')
  const named = stagePeople(stage.people, people)
  const names = named.map((p) => p.name).join(', ')
  // Names that do not fit turn into a people button; the hidden copy says how wide they are.
  useLayoutEffect(() => {
    const needed = (measure.current?.offsetWidth ?? 0) + (below ? 0 : BAR_PADDING)
    setCrowded(named.length > 0 && needed > width)
  }, [names, name, below, width, named.length])
  if (!box) return null

  const start = (grip: Grip) => (event: PointerEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, zoom: getZoom(), grip, span, moved: false }
  }
  const move = (event: PointerEvent) => {
    const current = drag.current
    if (!current) return
    if (!current.moved && Math.abs(event.clientX - current.x) < MOVE_PX) return
    current.moved = true
    setDragging(true)
    const days = Math.round((event.clientX - current.x) / current.zoom / pxPerDay)
    const wanted = dragSpan(current.span, current.grip, days)
    const next = stage.id === BARE ? wanted : clampStage(row, stage.id, wanted, current.grip)
    if (next.start === span.start && next.end === span.end) return
    onRow(
      stage.id === BARE
        ? { ...row, start: formatDay(next.start), end: formatDay(next.end) }
        : setStageSpan(row, stage.id, next),
    )
  }
  const stop = () => {
    const current = drag.current
    drag.current = null
    setDragging(false)
    if (current && !current.moved) onOpen(!open)
  }
  const handlers = { onPointerMove: move, onPointerUp: stop, onPointerCancel: stop }

  return (
    // Its own box for `peer-hover`: siblings in one row would light every later stage's tip.
    <div className="contents">
      <Popover open={open} onOpenChange={onOpen}>
        <PopoverAnchor asChild>
          <div
            role="slider"
            aria-label={`${name} stage of ${row.title || row.key || 'row'}`}
            aria-valuetext={formatSpan(span)}
            onPointerDown={start('move')}
            {...handlers}
            className={cn(
              'peer absolute top-1.5 flex h-5 cursor-grab items-center overflow-hidden rounded-[4px] px-1.5 text-[11px] leading-5 font-semibold whitespace-nowrap select-none active:cursor-grabbing',
              !type && 'bg-card text-muted-foreground border font-medium',
              box.clippedStart && 'rounded-l-none',
              box.clippedEnd && 'rounded-r-none',
            )}
            style={{
              left: box.left,
              width: Math.max(box.width, 4),
              ...(type && stageColors(type.hue)),
            }}
          >
            <span className="truncate">
              {name}
              {!below && !crowded && named.length > 0 && <Names named={named} lead=" · " />}
            </span>
            {!below && crowded && <PeopleButton named={named} stage={name} className="ml-auto" />}
            {!box.clippedStart && (
              <span
                aria-hidden
                onPointerDown={start('start')}
                className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
              />
            )}
            {!box.clippedEnd && (
              <span
                aria-hidden
                onPointerDown={start('end')}
                className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
              />
            )}
          </div>
        </PopoverAnchor>
        <span
          ref={measure}
          aria-hidden
          className="invisible absolute top-0 left-0 text-[11px] font-semibold whitespace-nowrap"
        >
          {below ? <Names named={named} /> : [name, <Names key="n" named={named} lead=" · " />]}
        </span>
        {below && named.length > 0 && (
          <div
            data-stage-people
            className="text-muted-foreground pointer-events-none absolute top-7 flex justify-center px-0.5 text-[11px] leading-4"
            style={{ left: box.left, width }}
          >
            {crowded ? (
              <PeopleButton named={named} stage={name} />
            ) : (
              <span className="truncate">
                <Names named={named} />
              </span>
            )}
          </div>
        )}
        <DatesTip
          span={span}
          note={`${names ? `${name} · ${names}` : name} · ${label}`}
          shown={dragging}
          left={box.left}
          right={box.left + box.width}
          width={rangeDays(range.start, range.end) * pxPerDay}
        />
        <PopoverContent side="bottom" align="start" className="w-72 p-3">
          <StageForm
            row={row}
            stage={stage}
            types={types}
            people={people}
            assignees={assignees}
            onRow={onRow}
            onReopen={onReopen}
            onClose={() => onOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Who is on a stage too narrow for their names: a count, and the names in a popover. */
function PeopleButton({
  named,
  stage,
  className,
}: {
  named: Named[]
  stage: string
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${named.length} people on ${stage}`}
          // The stage under it would start a drag or open its own popover.
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          className={cn(
            'hover:bg-foreground/10 pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-[3px] px-0.5 font-medium',
            className,
          )}
        >
          <Users className="size-3" strokeWidth={2} />
          {named.length}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="center" className="w-48 gap-1 p-2">
        <div className="text-muted-foreground px-1 text-[12px]">People on {stage}</div>
        <ul className="flex flex-col text-[13px]">
          {named.map((p) => (
            <li key={p.id} className={cn('px-1 py-0.5', p.archived && 'text-muted-foreground')}>
              {p.name}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** Names in a row; someone archived, or unknown here, reads muted. */
function Names({ named, lead = '' }: { named: Named[]; lead?: string }) {
  return (
    <span className="font-medium">
      {lead}
      {named.map((p, i) => (
        <Fragment key={p.id}>
          {i > 0 && ', '}
          <span className={cn(p.archived && 'opacity-60')}>{p.name}</span>
        </Fragment>
      ))}
    </span>
  )
}

function StageForm({
  row,
  stage,
  types,
  people,
  assignees,
  onRow,
  onReopen,
  onClose,
}: {
  row: Row
  stage: Stage
  types: StageType[]
  people: Person[]
  assignees: string[]
  onRow: (row: Row) => void
  onReopen: (id: string) => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const active = types.filter((t) => !t.archived)

  const change = (part: Partial<Omit<Stage, 'id'>>) => {
    const next = updateStage(row, stage.id, part)
    onRow(next)
    // The bare bar turns into a stage with an id of its own; the popover follows it.
    if (stage.id === BARE && next.stages?.length) onReopen(next.stages[0].id)
  }
  const pick = (type: string) => change({ type })
  const create = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const created = await addStageType({ name: trimmed, hue: freeHue(types) })
      storeStageType(queryClient, created)
      setAdding(false)
      setName('')
      pick(created.id)
    } catch (error) {
      toastError(error as Error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5 text-[13px]">
      <div className="font-semibold">
        Stage{' '}
        <span className="text-muted-foreground text-[12px] font-normal">
          in {row.title || row.key}
        </span>
      </div>
      <div role="group" aria-label="Stage type" className="flex flex-wrap gap-1">
        {active.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={t.id === stage.type}
            onClick={() => pick(t.id)}
            className={cn(
              'rounded-[4px] px-2 py-0.5 text-[12px] font-medium',
              t.id === stage.type && 'ring-primary ring-2',
            )}
            style={stageColors(t.hue)}
          >
            {t.name}
          </button>
        ))}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-muted-foreground hover:text-foreground rounded-[4px] border border-dashed px-2 py-0.5 text-[12px]"
          >
            <Plus className="mr-0.5 inline size-3" />
            New type
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={create} className="flex gap-1.5">
          <Input
            autoFocus
            aria-label="New stage type"
            placeholder="Type name, e.g. Testing"
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={!name.trim() || saving}>
            Add
          </Button>
        </form>
      )}
      <div className="text-muted-foreground text-[12px] tabular-nums">
        {formatSpan(stageSpan(stage))}
      </div>
      <StagePeople
        chosen={stage.people}
        people={people}
        assignees={assignees}
        onPeople={(ids) => change({ people: ids })}
      />
      <p className="text-muted-foreground text-[12px]">
        Stage types are shared by every board. The task in the tracker stays as it is.
      </p>
      {stage.id !== BARE && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              onClose()
              onRow(removeStage(row, stage.id))
            }}
          >
            <Trash2 className="size-3.5" />
            Delete stage
          </Button>
        </div>
      )}
    </div>
  )
}
