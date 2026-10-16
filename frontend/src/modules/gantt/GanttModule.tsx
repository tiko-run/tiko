import { useReactFlow, type XYPosition } from '@xyflow/react'
import { CalendarRange, ChevronDown, Diamond, Ellipsis, Plus, Users } from 'lucide-react'
import { useContext, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import type { Task } from '@/api/tasks'
import { taskRef, TasksContext } from '@/canvas/tasks-context'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { GanttAdd } from '@/modules/gantt/GanttAdd'
import { GanttBar } from '@/modules/gantt/GanttBar'
import { GanttColumns } from '@/modules/gantt/GanttColumns'
import { GanttLabel } from '@/modules/gantt/GanttLabel'
import { GanttStages } from '@/modules/gantt/GanttStages'
import { ConnectHandle, Links, type BarPlace, type Point } from '@/modules/gantt/Links'
import { Milestone } from '@/modules/gantt/Milestone'
import {
  addLink,
  addMilestone,
  MAX_MILESTONES,
  removeLink,
  removeMilestone,
  updateMilestone,
} from '@/modules/gantt/plan'
import {
  addRows,
  FOOTER,
  HEADER,
  HEADER_ROW,
  LABEL_WIDTH,
  makeRow,
  MAX_ROWS,
  pxPerDay,
  range,
  ROW_HEIGHT,
  rowHeight,
  rowTask,
  updateRow,
  type Row,
} from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'
import { fitLeaves, fitStages } from '@/modules/gantt/stages'
import { TimeOffLane } from '@/modules/gantt/TimeOffLane'
import { laneHeight, timeOffLane } from '@/modules/gantt/timeoff'
import {
  addChild,
  indent,
  liftRemove,
  moveSubtree,
  outdent,
  shiftBranch,
  subtreeEnd,
  branchSpan,
  resizeParent,
  visibleRows,
} from '@/modules/gantt/tree'
import {
  barBox,
  fitsRange,
  formatDay,
  header,
  parseDay,
  quarterAfter,
  quarterBefore,
  today,
  type Cell,
  type Span,
  type Scale,
} from '@/modules/gantt/timeline'
import type { ModuleControlsProps, ModuleViewProps } from '@/modules/types'
import { cn } from '@/lib/utils'
import { didOnboarding } from '@/onboarding/done'
import { usePlanning } from '@/planning/context'
import { openSettings } from '@/settings/store'

type Props = ModuleViewProps<GanttContent>

// A label narrower than this would be clipped to nonsense, so the cell stays blank.
const MIN_LABEL_PX = 40
const SCALES: { scale: Scale; label: string }[] = [
  { scale: 'day', label: 'Days' },
  { scale: 'week', label: 'Weeks' },
  { scale: 'month', label: 'Months' },
  { scale: 'quarter', label: 'Quarters' },
]

function HeaderRow({ cells, pxPerDay, top }: { cells: Cell[]; pxPerDay: number; top: boolean }) {
  return (
    <div className={cn('relative', !top && 'border-t')} style={{ height: HEADER_ROW }}>
      {cells.map((cell) => (
        <div
          key={cell.from}
          className={cn(
            'absolute inset-y-0 truncate border-l px-1.5 leading-6',
            top ? 'text-foreground font-medium' : 'text-muted-foreground',
          )}
          style={{ left: cell.from * pxPerDay, width: cell.span * pxPerDay }}
        >
          {cell.span * pxPerDay >= MIN_LABEL_PX && cell.label}
        </div>
      ))}
    </div>
  )
}

export function GanttModule({ content, width, selected, onChange: write, host }: Props) {
  // Every change passes here, so no tree edit leaves a leaf apart from its stages.
  const onChange = (next: GanttContent) => write(fitLeaves(next))
  const tasks = useContext(TasksContext)
  const planning = usePlanning()
  const taskOf = (row: Row) => {
    const task = rowTask(row)
    return task && tasks[taskRef(task)]
  }
  const [fresh, setFresh] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [wire, setWire] = useState<{ from: Point; to: Point } | null>(null)
  const span = range(content)
  const { start, end } = span
  const scale = pxPerDay(content, width, planning.enabled)
  const { top, bottom } = header(start, end, content.scale)
  const now = today()
  const before = quarterBefore(start)
  const after = quarterAfter(end)
  const height = rowHeight(content, planning.enabled)
  const away = timeOffLane(content, planning, span)
  const lane = laneHeight(away.lanes)
  const assignees = [
    ...new Set(content.rows.flatMap((row) => taskOf(row)?.assignee_name ?? [])),
  ].sort()
  const full = content.rows.length >= MAX_ROWS
  const visible = visibleRows(content.rows)
  const indexOf = new Map(content.rows.map((r, i) => [r.id, i]))
  const barSpan = (row: Row) => branchSpan(content.rows, indexOf.get(row.id)!)
  const bars = new Map<string, BarPlace>()
  visible.forEach(({ row }, i) => {
    const rowSpan = barSpan(row)
    const box = barBox(rowSpan, span, scale)
    if (!box) return
    // Bars keep to the top of a taller row; the names sit under them.
    const y = lane + i * height + ROW_HEIGHT / 2
    bars.set(row.id, { left: box.left, right: box.left + box.width, y, span: rowSpan })
  })
  const link = (from: string, target: Element | null) => {
    const to = target?.closest('[data-gantt-row]')?.getAttribute('data-gantt-row')
    const next = to ? addLink(content, from, to) : null
    if (next) onChange(next)
  }
  // A parent's bar moves its whole branch, or stretches its own dates around its children.
  const onParentSpan = (row: Row, next: Span) => {
    const current = barSpan(row)
    const moved = next.end - next.start === current.end - current.start
    onChange(
      moved
        ? shiftBranch(content, row.id, next.start - current.start)
        : resizeParent(content, row.id, next),
    )
  }

  const addTasks = (list: Task[]) => {
    didOnboarding('gantt_task')
    host.addTasks(list)
    onChange(
      addRows(
        content,
        list.map((task) => makeRow(content, { key: task.key, source: task.source })),
      ),
    )
  }
  const eject = (row: Row, screen: XYPosition) => {
    const task = rowTask(row)
    if (task) host.ejectCard(task, screen)
    else host.ejectNote(row.title, screen)
    onChange(liftRemove(content, row.id))
  }
  const addChildRow = (parentId: string) => {
    if (full) return
    const row = makeRow(content, {})
    setFresh(row.id)
    onChange(addChild(content, parentId, row))
  }
  // Rows dropped among the others: the dragged subtree is left out when counting places.
  const drop = (id: string, depth: number, rowsDown: number, levels: number) => {
    const at = visible.findIndex((t) => t.row.id === id)
    const end = subtreeEnd(content.rows, indexOf.get(id)!)
    const moving = new Set(content.rows.slice(indexOf.get(id)!, end).map((r) => r.id))
    const rest = visible.filter((t) => !moving.has(t.row.id))
    const slot = Math.min(Math.max(at + rowsDown, 0), rest.length)
    onChange(moveSubtree(content, id, rest[slot]?.row.id ?? null, depth + levels))
  }

  return (
    <div className="flex h-full text-[12px]">
      <div
        className="relative flex shrink-0 flex-col border-r"
        style={{ width: content.labelWidth }}
      >
        <ColumnResizer
          width={content.labelWidth}
          max={Math.min(LABEL_WIDTH.max, width - LABEL_WIDTH.min)}
          onWidth={(labelWidth) => onChange({ ...content, labelWidth })}
        />
        <div
          className="text-muted-foreground flex shrink-0 items-center border-b px-3"
          style={{ height: HEADER }}
        >
          {formatRange(content.start, content.end)}
        </div>
        {lane > 0 && (
          <div
            className="text-muted-foreground bg-muted shrink-0 border-b px-3 leading-8 font-medium"
            style={{ height: lane }}
          >
            Time off
          </div>
        )}
        {visible.map(({ row, depth, hasChildren }) => (
          <GanttLabel
            key={row.id}
            row={row}
            depth={depth}
            hasChildren={hasChildren}
            height={height}
            task={taskOf(row)}
            url={taskOf(row)?.url}
            fresh={row.id === fresh}
            onTitle={(title) => onChange(updateRow(content, row.id, (r) => ({ ...r, title })))}
            onRemove={() => onChange(liftRemove(content, row.id))}
            onToggle={() =>
              onChange(updateRow(content, row.id, (r) => ({ ...r, collapsed: !r.collapsed })))
            }
            onIndent={() => onChange(indent(content, row.id))}
            onOutdent={() => onChange(outdent(content, row.id))}
            onAddChild={() => addChildRow(row.id)}
            onMove={(rowsDown, levels) => drop(row.id, depth, rowsDown, levels)}
            onEject={(screen) => eject(row, screen)}
          />
        ))}
        <div className="mt-auto flex shrink-0 items-center gap-1 px-1" style={{ height: FOOTER }}>
          <GanttAdd
            disabled={full}
            onTasks={addTasks}
            onPlain={(title) => {
              didOnboarding('gantt_task')
              onChange(addRows(content, [makeRow(content, { title })]))
            }}
          />
        </div>
      </div>
      {planning.enabled && (
        <GanttColumns
          content={content}
          visible={visible.map(({ row }) => row)}
          fields={planning.fields}
          rowHeight={height}
          lane={lane}
          onChange={onChange}
          onRow={(next) => onChange(updateRow(content, next.id, () => next))}
        />
      )}
      <div data-gantt-body className="relative min-w-0 flex-1">
        <div className="border-b">
          <HeaderRow cells={top} pxPerDay={scale} top />
          <HeaderRow cells={bottom} pxPerDay={scale} top={false} />
        </div>
        <div className="absolute inset-x-0 bottom-0" style={{ top: HEADER }}>
          {/* Under the week lines, so the Time off lane keeps the grid. */}
          {lane > 0 && (
            <div className="bg-muted absolute inset-x-0 top-0" style={{ height: lane }} />
          )}
          {bottom.map((cell) => (
            <div
              key={cell.from}
              className={cn(
                'absolute inset-y-0 border-l border-border/60',
                cell.weekend && 'bg-muted/60',
              )}
              style={{ left: cell.from * scale, width: cell.span * scale }}
            />
          ))}
        </div>
        {/* After the grid: the lane is in the flow above the rows, the grid must not cover it. */}
        {lane > 0 && (
          <TimeOffLane
            items={away.items}
            height={lane}
            range={span}
            pxPerDay={scale}
            people={planning.people}
          />
        )}
        {now >= start && now <= end && (
          <div
            data-testid="gantt-today"
            title="Today"
            className="bg-primary pointer-events-none absolute bottom-0 z-10 w-px"
            style={{ left: (now - start + 0.5) * scale, top: HEADER }}
          />
        )}
        {visible.map(({ row, hasChildren }) => (
          <div
            key={row.id}
            data-gantt-row={row.id}
            className="group/row relative border-b border-border/60"
            style={{ height }}
          >
            {planning.enabled && !hasChildren ? (
              <GanttStages
                row={row}
                range={span}
                pxPerDay={scale}
                types={planning.types}
                people={planning.people}
                assignees={assignees}
                below={content.people === 'below'}
                label={stagesLabel(row, taskOf(row))}
                onRow={(next) => onChange(updateRow(content, row.id, () => next))}
              />
            ) : (
              <GanttBar
                span={barSpan(row)}
                summary={hasChildren}
                range={span}
                pxPerDay={scale}
                label={row.key ? `${row.key} ${taskOf(row)?.summary ?? ''}` : row.title}
                task={taskOf(row)}
                onSpan={(next) =>
                  hasChildren
                    ? onParentSpan(row, next)
                    : onChange(updateRow(content, row.id, (r) => fitStages(r, next)))
                }
              />
            )}
            {bars.has(row.id) && (
              <ConnectHandle
                bar={bars.get(row.id)!}
                onWire={setWire}
                onDrop={(target) => link(row.id, target)}
              />
            )}
          </div>
        ))}
        <Links
          links={content.links}
          bars={bars}
          wire={wire}
          picked={selected ? picked : null}
          onPick={setPicked}
          rowHeight={height}
          onRemove={(id) => {
            setPicked(null)
            onChange(removeLink(content, id))
          }}
        />
        {content.milestones.map((milestone) => (
          <Milestone
            key={milestone.id}
            milestone={milestone}
            range={span}
            pxPerDay={scale}
            onChange={(change) => onChange(updateMilestone(content, milestone.id, change))}
            onRemove={() => onChange(removeMilestone(content, milestone.id))}
          />
        ))}
        {content.rows.length === 0 && (
          <p
            className="text-muted-foreground pointer-events-none relative px-3 leading-8"
            style={{ height: ROW_HEIGHT }}
          >
            Drop cards here, or add a task or a row.
          </p>
        )}
        {selected && (
          <>
            <QuarterButton
              side="start"
              disabled={!fitsRange(before, end)}
              onClick={() => onChange({ ...content, start: formatDay(before) })}
            />
            <QuarterButton
              side="end"
              disabled={!fitsRange(start, after)}
              onClick={() => onChange({ ...content, end: formatDay(after) })}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** Grip on the label column's right border: drag to show more or less of the titles. */
function ColumnResizer({
  width,
  max,
  onWidth,
}: {
  width: number
  max: number
  onWidth: (width: number) => void
}) {
  const { getZoom } = useReactFlow()
  const drag = useRef<{ x: number; width: number; zoom: number } | null>(null)
  const move = (event: PointerEvent) => {
    const start = drag.current
    if (!start) return
    const next = Math.round(start.width + (event.clientX - start.x) / start.zoom)
    const clamped = Math.min(Math.max(next, LABEL_WIDTH.min), max)
    if (clamped !== width) onWidth(clamped)
  }
  const stop = () => (drag.current = null)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the task column"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, width, zoom: getZoom() }
      }}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
      className="hover:bg-primary/40 active:bg-primary absolute inset-y-0 -right-[3px] z-20 w-1.5 cursor-col-resize"
    />
  )
}

function QuarterButton({
  side,
  disabled,
  onClick,
}: {
  side: 'start' | 'end'
  disabled: boolean
  onClick: () => void
}) {
  const label = side === 'start' ? 'Add a quarter before' : 'Add a quarter after'
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      title={disabled ? 'The range is limited to 3 years' : label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'nodrag nopan absolute top-1/2 size-6 -translate-y-1/2 rounded-full shadow-sm',
        side === 'start' ? '-left-3' : '-right-3',
      )}
    >
      <Plus className="size-3.5" />
    </Button>
  )
}

function stagesLabel(row: Row, task: Task | undefined) {
  return task?.state === 'ok'
    ? `${row.key} ${task.summary} · ${task.status_name}`
    : row.key || row.title
}

function formatRange(start: string, end: string) {
  const fmt = (iso: string, year: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(year && { year: 'numeric' }),
      timeZone: 'UTC',
    })
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`
}

/** Scale, range dates and milestones in the selection bar; Planning options behind "More". */
export function GanttControls({ content, onChange, side }: ModuleControlsProps<GanttContent>) {
  const planning = usePlanning()
  const current = SCALES.find((s) => s.scale === content.scale) ?? SCALES[1]
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={`Scale: ${current.label}`}>
            {current.label}
            <ChevronDown className="size-3.5" strokeWidth={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align="start">
          <DropdownMenuRadioGroup
            value={content.scale}
            onValueChange={(scale) => onChange({ ...content, scale: scale as Scale })}
          >
            {SCALES.map(({ scale, label }) => (
              <DropdownMenuRadioItem key={scale} value={scale}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <RangePopover content={content} onChange={onChange} side={side} />
      <Button
        size="sm"
        variant="ghost"
        disabled={content.milestones.length >= MAX_MILESTONES}
        title="Add a milestone in the middle of the range; drag it to its date"
        onClick={() => {
          const { start, end } = range(content)
          onChange(addMilestone(content, Math.floor((start + end) / 2)))
        }}
      >
        <Diamond className="size-4" strokeWidth={1.75} />
        Milestone
      </Button>
      {planning.enabled && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More Gantt options">
              <Ellipsis className="size-4" strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={side} align="end" className="w-52">
            <DropdownMenuLabel className="text-muted-foreground text-[12px] font-normal">
              Names of people
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={content.people ?? 'inline'}
              onValueChange={(where) => {
                const { people: _people, ...rest } = content
                onChange(where === 'below' ? { ...content, people: 'below' } : rest)
              }}
            >
              <DropdownMenuRadioItem value="inline">After the stage type</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="below">Under each stage</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openSettings('planning')}>
              <Users className="size-4" strokeWidth={1.75} />
              People…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}

function RangePopover({ content, onChange, side }: ModuleControlsProps<GanttContent>) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ start: content.start, end: content.end })
  const valid =
    Boolean(draft.start && draft.end) && fitsRange(parseDay(draft.start), parseDay(draft.end))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    onChange({ ...content, ...draft })
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft({ start: content.start, end: content.end })
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant={open ? 'secondary' : 'ghost'} aria-label="Dates">
          <CalendarRange className="size-4" strokeWidth={1.75} />
          Dates
        </Button>
      </PopoverTrigger>
      <PopoverContent side={side} className="w-64 p-3">
        <form onSubmit={submit} className="flex flex-col gap-2">
          {(['start', 'end'] as const).map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <Label htmlFor={`gantt-${field}`} className="text-[13px] capitalize">
                {field}
              </Label>
              <Input
                id={`gantt-${field}`}
                type="date"
                value={draft[field]}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              />
            </div>
          ))}
          {!valid && (
            <p role="alert" className="text-destructive text-[13px]">
              The end must be after the start, at most 3 years apart.
            </p>
          )}
          <Button type="submit" size="sm" disabled={!valid}>
            Apply
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
