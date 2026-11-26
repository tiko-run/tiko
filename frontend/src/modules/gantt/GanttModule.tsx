import { useStoreApi, type XYPosition } from '@xyflow/react'
import {
  CalendarRange,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Diamond,
  Ellipsis,
  Plus,
  Users,
} from 'lucide-react'
import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import type { Task } from '@/api/tasks'
import { useReadOnly } from '@/canvas/readonly'
import { taskRef, TasksContext } from '@/canvas/tasks-context'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { GanttFilters } from '@/modules/gantt/GanttFilters'
import { GanttLabel } from '@/modules/gantt/GanttLabel'
import { GanttStages } from '@/modules/gantt/GanttStages'
import {
  DragGhost,
  DragStore,
  DragStoreContext,
  FadeWhileDragging,
  LassoBox,
  Placeholder,
  Shift,
} from '@/modules/gantt/drag-store'
import { useRowDrag } from '@/modules/gantt/useRowDrag'
import { select } from '@/modules/gantt/drag'
import { activeFilters, FILTER_BAR, shownRows } from '@/modules/gantt/filters'
import { ConnectHandle, Links, type BarPlace, type Point } from '@/modules/gantt/Links'
import { Milestone } from '@/modules/gantt/Milestone'
import {
  detachEdited,
  drift,
  follows,
  followTracker,
  trackedKey,
  trackerDates,
  trackerSpan,
  withFollow,
  type Tracked,
} from '@/modules/gantt/follow'
import { leafDone, progress, syncDone, tickRow } from '@/modules/gantt/done'
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
  axisOf,
  FOOTER,
  HEADER,
  HEADER_ROW,
  LABEL_WIDTH,
  makeRow,
  MAX_ROWS,
  range,
  ROW_HEIGHT,
  rowHeight,
  rowTask,
  timelineLeft,
  updateRow,
  type Row,
} from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'
import { fitLeaves, fitStages, spreadStages } from '@/modules/gantt/stages'
import { TimeOffLane } from '@/modules/gantt/TimeOffLane'
import { laneHeight, timeOffLane } from '@/modules/gantt/timeoff'
import {
  addChild,
  indent,
  liftRemove,
  removeBranch,
  foldAll,
  moveRows,
  movingRows,
  outdent,
  shiftBranch,
  branchSpan,
  resizeParent,
} from '@/modules/gantt/tree'
import {
  barBox,
  extend,
  fitsRange,
  formatDay,
  header,
  isWeekend,
  parseDay,
  today,
  xOf,
  type Axis,
  type Cell,
  type Span,
  type Scale,
} from '@/modules/gantt/timeline'
import type { ModuleControlsProps, ModuleViewProps } from '@/modules/types'
import { useZoom } from '@/modules/expanded'
import { cn } from '@/lib/utils'
import { didOnboarding } from '@/onboarding/done'
import { usePlanning } from '@/planning/context'
import { openSettings } from '@/settings/store'
import { shortKey } from '@/sources/registry'

type Props = ModuleViewProps<GanttContent>

// Rows dropped on the board together go in a column, each this far below the one before, in
// board pixels: a card at its usual height and a sticky note at the board's size, plus a gap.
const EJECTED = { card: 96, note: 200, gap: 16 }
// Tells every Gantt in the tab that one of them has picked rows, so only one selection is live.
const PICKED = 'tiko:gantt-rows-picked'
// A label narrower than this would be clipped to nonsense, so the cell stays blank.
const MIN_LABEL_PX = 40
const SCALES: { scale: Scale; label: string }[] = [
  { scale: 'day', label: 'Days' },
  { scale: 'week', label: 'Weeks' },
  { scale: 'month', label: 'Months' },
  { scale: 'quarter', label: 'Quarters' },
]

/** Header cells in pixels; a cell of hidden weekend days only is left out. */
function placed(cells: Cell[], axis: Axis) {
  return cells.flatMap((cell) => {
    const from = axis.range.start + cell.from
    const left = xOf(axis, from)
    const width = xOf(axis, from + cell.span) - left
    return width > 0 ? [{ ...cell, left, width }] : []
  })
}

function HeaderRow({ cells, top }: { cells: ReturnType<typeof placed>; top: boolean }) {
  return (
    <div className={cn('relative', !top && 'border-t')} style={{ height: HEADER_ROW }}>
      {cells.map((cell) => (
        <div
          key={cell.from}
          className={cn(
            'absolute inset-y-0 truncate border-l px-1.5 text-center text-[12px] leading-6',
            top ? 'text-foreground font-semibold' : 'text-muted-foreground',
          )}
          style={{ left: cell.left, width: cell.width }}
        >
          {cell.width >= MIN_LABEL_PX && cell.label}
        </div>
      ))}
    </div>
  )
}

export function GanttModule({
  id,
  content: stored,
  width,
  height: viewHeight,
  selected,
  expanded,
  onChange: write,
  host,
}: Props) {
  const tasks = useContext(TasksContext)
  const planning = usePlanning()
  const readOnly = useReadOnly()
  const taskOf = (row: Row) => {
    const task = rowTask(row)
    return task && tasks[taskRef(task)]
  }
  // Following rows show their task's dates; the board keeps them outside undo, so a guest of a
  // public link, who cannot read the tracker, sees the same bars.
  const content = followTracker(stored, taskOf)
  const latest = useRef(content)
  const saved = useRef(stored)
  useEffect(() => {
    latest.current = content
    saved.current = stored
  })
  // Written when this tab's own tracker data changes, not on every change of the board: two
  // editors whose snapshots differ for a moment would otherwise overwrite each other in turn.
  const tracked = trackedKey(stored, taskOf)
  useEffect(() => {
    if (!readOnly && latest.current !== saved.current) host.syncContent(id, latest.current)
  }, [tracked, readOnly, host, id])
  const setFollow = (ids: string[], follow: boolean) => {
    const now = latest.current
    write({
      ...now,
      rows: now.rows.map((r) => (ids.includes(r.id) ? withFollow(r, follow) : r)),
    })
  }
  // Every change passes here, so no tree edit leaves a leaf apart from its stages, and a bar
  // a person moved keeps the dates they gave it.
  const onChange = (next: GanttContent) => {
    const { content: kept, detached } = detachEdited(content, fitLeaves(syncDone(next)))
    write(kept)
    if (detached.length === 0) return
    toast(
      detached.length === 1
        ? 'The bar keeps your dates now, not the tracker’s'
        : `${detached.length} bars keep your dates now, not the tracker’s`,
      { action: { label: 'Undo', onClick: () => setFollow(detached, true) } },
    )
  }
  const [fresh, setFresh] = useState<string | null>(null)
  const [store] = useState(() => new DragStore())
  const rootEl = useRef<HTMLDivElement>(null)
  const token = useId()
  const flowStore = useStoreApi()
  const rowsEl = useRef<HTMLDivElement>(null)
  const ghostEl = useRef<HTMLDivElement>(null)
  const getZoom = useZoom()
  const [picked, setPicked] = useState<string | null>(null)
  // Rows picked in the task column: this tab's own, never stored or sent.
  const [rowsPicked, setRowsPicked] = useState<ReadonlySet<string>>(() => new Set())
  const anchor = useRef<string | null>(null)
  const [wire, setWire] = useState<{ from: Point; to: Point } | null>(null)
  const todayLine = useRef<HTMLDivElement>(null)
  const opened = useRef(false)
  const span = range(content)
  const { start, end } = span
  const axis = axisOf(content, width, planning, expanded)
  const cells = header(start, end, content.scale, axis.working)
  const top = placed(cells.top, axis)
  const bottom = placed(cells.bottom, axis)
  // Shaded like a weekend, on days the Gantt shows.
  const daysOff = [...axis.off].filter((day) => day >= start && day <= end && !isWeekend(day))
  const now = today()
  const left = timelineLeft(content, planning.enabled)
  const todayX = xOf(axis, now)
  // Expanded, the plan opens with today in the middle of the timeline, once.
  useEffect(() => {
    if (!expanded || opened.current || width <= 0) return
    opened.current = true
    const scroller = todayLine.current?.closest('[data-expanded-scroll]')
    if (scroller) scroller.scrollLeft = todayX - (width - left) / 2
  }, [expanded, todayX, width, left])
  const before = extend(start, content.scale, 'start')
  const after = extend(end, content.scale, 'end')
  const height = rowHeight(content, planning.enabled)
  const away = timeOffLane(content, planning, span)
  const lane = laneHeight(away.lanes)
  const assignees = [
    ...new Set(content.rows.flatMap((row) => taskOf(row)?.assignee_name ?? [])),
  ].sort()
  const full = content.rows.length >= MAX_ROWS
  const visible = shownRows(content, planning)
  const filtered = activeFilters(content, planning.enabled) !== null
  const nested = !readOnly && content.rows.some((r) => r.parent)
  const indexOf = new Map(content.rows.map((r, i) => [r.id, i]))
  const barSpan = (row: Row) => branchSpan(content.rows, indexOf.get(row.id)!)
  const bars = new Map<string, BarPlace>()
  visible.forEach(({ row }, i) => {
    const rowSpan = barSpan(row)
    const box = barBox(rowSpan, axis)
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
  // Rows dropped on the board go in a column from the drop point, in plan order; a parent takes
  // its branch along, as it does when dragged inside the plan.
  const eject = (ids: string[], screen: XYPosition) => {
    const zoom = getZoom()
    const { moving } = movingRows(content.rows, ids)
    let next = content
    // Where the next one starts; a card hangs from its point, a note is centred on it.
    let top: number | null = null
    content.rows.forEach((row) => {
      if (!moving.has(row.id)) return
      const id = row.id
      const task = rowTask(row)
      const half = (EJECTED.note / 2) * zoom
      const y = top === null ? screen.y : task ? top : top + half
      const at = { x: screen.x, y }
      if (task) host.ejectCard(task, at)
      else host.ejectNote(row.title, at)
      top = (task ? y + EJECTED.card * zoom : y + half) + EJECTED.gap * zoom
      next = liftRemove(next, id)
    })
    onChange(next)
  }
  const addChildRow = (parentId: string) => {
    if (full) return
    const row = makeRow(content, {})
    setFresh(row.id)
    onChange(addChild(content, parentId, row))
  }
  const extenders = (
    <>
      <ExtendButton
        side="start"
        unit={before.unit}
        inside={expanded}
        disabled={!fitsRange(before.day, end)}
        onClick={() => onChange({ ...content, start: formatDay(before.day) })}
      />
      <ExtendButton
        side="end"
        unit={after.unit}
        inside={expanded}
        disabled={!fitsRange(start, after.day)}
        onClick={() => onChange({ ...content, end: formatDay(after.day) })}
      />
    </>
  )
  // Expanded, the headers and the title column stay in view while the plan scrolls under them.
  const stickTop = planning.enabled ? FILTER_BAR : 0
  const stuck = expanded ? 'sticky z-20' : undefined
  // Only rows in view count as selected: a filter, a fold or someone else's delete drops the rest.
  const selection = new Set(visible.filter((t) => rowsPicked.has(t.row.id)).map((t) => t.row.id))
  const pickRows = (ids: ReadonlySet<string>) => {
    if (ids.size === 0) anchor.current = null
    else window.dispatchEvent(new CustomEvent(PICKED, { detail: token }))
    setRowsPicked(ids)
  }
  const rowDrag = useRowDrag({
    store,
    rowsEl,
    ghostEl,
    rows: content.rows,
    visible,
    rowHeight: height,
    expanded,
    edgeTop: stickTop + HEADER,
    onDrop: (ids, aboveId, depth) => {
      pickRows(new Set(ids))
      onChange(moveRows(content, ids, aboveId, depth))
    },
    onEject: (ids, screen) => {
      pickRows(new Set())
      eject(ids, screen)
    },
    onClick: (id, event) => {
      const order = visible.map((t) => t.row.id)
      const toggle = event.metaKey || event.ctrlKey
      const next = select(selection, anchor.current, id, order, { shift: event.shiftKey, toggle })
      pickRows(next.selected)
      anchor.current = next.anchor
    },
    onSelect: pickRows,
  })
  const lassoFrom = (event: PointerEvent, id?: string) =>
    rowDrag.lasso(
      event,
      event.shiftKey || event.metaKey || event.ctrlKey ? selection : new Set(),
      id,
    )
  // Esc clears the selection and Delete removes its rows, before the board or the expanded view
  // hears either: the module itself is never deleted from here.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    keys.current = (event) => {
      if (!ownsKey(event, rootEl.current)) return
      if (event.key === 'Escape' && !rowDrag.busy()) {
        event.preventDefault()
        event.stopPropagation()
        pickRows(new Set())
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        event.stopPropagation()
        pickRows(new Set())
        onChange([...selection].reduce((next, id) => removeBranch(next, id), content))
      }
    }
  })
  // Rows that leave the view leave the selection for good: folding a parent and opening it again
  // must not pick its children again without a new click.
  const shownKey = visible.map((t) => t.row.id).join(' ')
  useEffect(() => {
    const shown = new Set(shownKey.split(' '))
    if (anchor.current !== null && !shown.has(anchor.current)) anchor.current = null
    setRowsPicked((current) =>
      [...current].every((id) => shown.has(id))
        ? current
        : new Set([...current].filter((id) => shown.has(id))),
    )
  }, [shownKey])
  const anyPicked = selection.size > 0
  useEffect(() => {
    if (!anyPicked) return
    const listen = (event: KeyboardEvent) => keys.current(event)
    window.addEventListener('keydown', listen, true)
    return () => window.removeEventListener('keydown', listen, true)
  }, [anyPicked])
  // Another Gantt, or this one expanded over the board, picked rows: this selection ends.
  useEffect(() => {
    const other = (event: Event) => {
      if ((event as CustomEvent).detail !== token) setRowsPicked(new Set())
    }
    window.addEventListener(PICKED, other)
    return () => window.removeEventListener(PICKED, other)
  }, [token])
  // Selecting something else on the board ends the selection.
  const wasSelected = useRef(selected)
  useEffect(() => {
    if (wasSelected.current && !selected) setRowsPicked(new Set())
    wasSelected.current = selected
  }, [selected])
  const labelOf = (row: Row) =>
    row.key ? `${keyOf(row, taskOf(row))} ${taskOf(row)?.summary ?? ''}` : row.title || 'Untitled'

  return (
    <DragStoreContext.Provider value={store}>
      <div
        ref={rootEl}
        // A popover's keys bubble through React to the board's node, whose Esc deselects the Gantt
        // and whose arrows move it; they belong to the popover.
        onKeyDown={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) event.stopPropagation()
        }}
        className={cn('flex flex-col text-[13px]', !expanded && 'h-full')}
        style={
          expanded
            ? { width: Math.max(width, left + axis.width), minHeight: viewHeight }
            : undefined
        }
      >
        {planning.enabled && (
          <div
            className={cn('shrink-0', expanded && 'bg-card sticky top-0 left-0 z-40')}
            style={expanded ? { width } : undefined}
          >
            <GanttFilters content={content} planning={planning} onChange={onChange} />
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className={cn('bg-panel flex shrink-0', expanded && 'sticky left-0 z-30')}>
            <div
              // nokey: with Shift held the board would take a press here, on the rows or the band
              // under them, for its own selection box.
              className="nokey relative flex shrink-0 flex-col border-r"
              style={{ width: content.labelWidth }}
              // The blank band under the rows starts a lasso too.
              onPointerDown={(event) => {
                if (event.target === event.currentTarget && !readOnly) lassoFrom(event)
              }}
              // Shift or Cmd here picks rows; the board must not take it as a click that drops
              // the Gantt from its own selection.
              // It still selects this Gantt, so a selection in another one ends.
              onClick={(event) => {
                // A clicked button or link gives focus back, so the board hears its keys again:
                // it ignores them while focus is inside nokey.
                const control = (event.target as Element).closest('button, a')
                if (control instanceof HTMLElement) control.blur()
                if (!event.shiftKey && !event.metaKey && !event.ctrlKey) return
                event.stopPropagation()
                if (!selected && !expanded) flowStore.getState().addSelectedNodes([id])
              }}
            >
              <ColumnResizer
                width={content.labelWidth}
                max={Math.min(LABEL_WIDTH.max, width - LABEL_WIDTH.min)}
                onWidth={(labelWidth) => onChange({ ...content, labelWidth })}
              />
              <div
                className={cn(
                  'text-muted-foreground bg-panel flex shrink-0 items-center border-b px-3',
                  stuck,
                )}
                style={{ height: HEADER, top: stickTop }}
              >
                <span className="min-w-0 flex-1 truncate">
                  {formatRange(content.start, content.end)}
                </span>
                {nested && (
                  <>
                    <FoldAll label="Expand all" onClick={() => onChange(foldAll(content, false))}>
                      <ChevronsUpDown className="size-3.5" />
                    </FoldAll>
                    <FoldAll label="Collapse all" onClick={() => onChange(foldAll(content, true))}>
                      <ChevronsDownUp className="size-3.5" />
                    </FoldAll>
                  </>
                )}
              </div>
              {lane > 0 && (
                <div
                  className="text-muted-foreground bg-muted shrink-0 border-b px-3 leading-8 font-medium"
                  style={{ height: lane }}
                >
                  Time off
                </div>
              )}
              <div
                ref={rowsEl}
                data-gantt-rows
                role="listbox"
                aria-label="Rows"
                aria-multiselectable
                className="relative"
              >
                {visible.map(({ row, depth, hasChildren }) => (
                  <Shift key={row.id} id={row.id} label selected={selection.has(row.id)}>
                    <GanttLabel
                      row={row}
                      depth={depth}
                      hasChildren={hasChildren}
                      height={height}
                      task={taskOf(row)}
                      url={taskOf(row)?.url}
                      fresh={row.id === fresh}
                      onTitle={(title) =>
                        onChange(updateRow(content, row.id, (r) => ({ ...r, title })))
                      }
                      onRemove={() => onChange(removeBranch(content, row.id))}
                      onToggle={() =>
                        onChange(
                          updateRow(content, row.id, (r) => ({ ...r, collapsed: !r.collapsed })),
                        )
                      }
                      onIndent={() => onChange(indent(content, row.id))}
                      onOutdent={() => onChange(outdent(content, row.id))}
                      onAddChild={() => addChildRow(row.id)}
                      onPress={(event) =>
                        rowDrag.press(
                          event,
                          row.id,
                          selection.has(row.id) ? [...selection] : [row.id],
                        )
                      }
                      onLasso={(event) => lassoFrom(event, row.id)}
                      follow={
                        row.key && !hasChildren && !row.stages?.length
                          ? Boolean(row.follow)
                          : undefined
                      }
                      onFollow={(follow) => setFollow([row.id], follow)}
                      done={!hasChildren && leafDone(row, taskOf(row))}
                      onDone={
                        readOnly || row.key
                          ? undefined
                          : (done) => onChange(tickRow(content, row.id, done))
                      }
                      progress={
                        hasChildren
                          ? progress(content.rows, indexOf.get(row.id)!, taskOf)
                          : undefined
                      }
                    />
                  </Shift>
                ))}
                <Placeholder />
                <LassoBox />
                <DragGhost
                  ref={ghostEl}
                  labelOf={labelOf}
                  height={height}
                  width={content.labelWidth}
                />
              </div>
              <div
                className="mt-auto flex shrink-0 items-center gap-1 px-1"
                style={{ height: FOOTER }}
              >
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
                selected={selection}
                fields={planning.fields}
                rowHeight={height}
                lane={lane}
                stickTop={expanded ? stickTop : undefined}
                onChange={onChange}
                onRow={(next) => onChange(updateRow(content, next.id, () => next))}
              />
            )}
          </div>
          <div data-gantt-body className="relative min-w-0 flex-1">
            <div className={cn('border-b', stuck, expanded && 'bg-card')} style={{ top: stickTop }}>
              <HeaderRow cells={top} top />
              <HeaderRow cells={bottom} top={false} />
              {/* Expanded, the buttons ride in the header so they stay in view. */}
              {selected && expanded && extenders}
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
                  style={{ left: cell.left, width: cell.width }}
                />
              ))}
              {daysOff.map((day) => (
                <div
                  key={day}
                  data-gantt-day-off
                  title="Day off"
                  className="bg-muted/60 absolute inset-y-0"
                  style={{ left: xOf(axis, day), width: axis.px }}
                />
              ))}
            </div>
            {/* After the grid: the lane is in the flow above the rows, the grid must not cover it. */}
            {lane > 0 && (
              <TimeOffLane items={away.items} height={lane} axis={axis} people={planning.people} />
            )}
            {now >= start && now <= end && (
              <div
                ref={todayLine}
                data-testid="gantt-today"
                title="Today"
                className="bg-primary pointer-events-none absolute bottom-0 z-10 w-px"
                style={{
                  left: xOf(axis, now) + (axis.working && isWeekend(now) ? 0 : axis.px / 2),
                  top: HEADER,
                }}
              />
            )}
            {visible.map(({ row, hasChildren }) => {
              const task = taskOf(row)
              // Rows with their own dates show the tracker's beside them where the two differ.
              const off = row.key && !follows(row, hasChildren) ? drift(task, barSpan(row)) : null
              const ghost = off && (
                <DriftGhost
                  tracked={off}
                  axis={axis}
                  bar={bars.get(row.id)}
                  onSpread={
                    readOnly || hasChildren || !row.stages?.length
                      ? undefined
                      : () => {
                          const next = spreadStages(row, off.span, axis)
                          if (next) onChange(updateRow(content, row.id, () => next))
                        }
                  }
                  canSpread={spreadStages(row, off.span, axis) !== null}
                  parent={hasChildren}
                  onFollow={
                    readOnly || hasChildren || row.stages?.length
                      ? undefined
                      : () => setFollow([row.id], true)
                  }
                />
              )
              return (
                <Shift key={row.id} id={row.id} selected={selection.has(row.id)}>
                  <div
                    data-gantt-row={row.id}
                    className="group/row relative border-b border-border/60"
                    style={{ height }}
                  >
                    {planning.enabled && !hasChildren ? (
                      <GanttStages
                        row={row}
                        axis={axis}
                        types={planning.types}
                        people={planning.people}
                        assignees={assignees}
                        below={content.people === 'below'}
                        label={stagesLabel(row, taskOf(row))}
                        done={leafDone(row, task)}
                        {...trackerNotes(row, hasChildren, task, off)}
                        onRow={(next) => onChange(updateRow(content, row.id, () => next))}
                      />
                    ) : (
                      <GanttBar
                        span={barSpan(row)}
                        summary={hasChildren}
                        axis={axis}
                        label={
                          row.key
                            ? `${keyOf(row, taskOf(row))} ${taskOf(row)?.summary ?? ''}`
                            : row.title
                        }
                        task={task}
                        done={!hasChildren && leafDone(row, task)}
                        {...trackerNotes(row, hasChildren, task, off)}
                        onSpan={(next) =>
                          hasChildren
                            ? onParentSpan(row, next)
                            : onChange(updateRow(content, row.id, (r) => fitStages(r, next)))
                        }
                      />
                    )}
                    {ghost}
                    {bars.has(row.id) && (
                      <ConnectHandle
                        bar={bars.get(row.id)!}
                        onWire={setWire}
                        onDrop={(target) => link(row.id, target)}
                      />
                    )}
                  </div>
                </Shift>
              )
            })}
            <FadeWhileDragging>
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
            </FadeWhileDragging>
            {content.milestones.map((milestone) => (
              <Milestone
                key={milestone.id}
                milestone={milestone}
                axis={axis}
                onChange={(change) => onChange(updateMilestone(content, milestone.id, change))}
                onRemove={() => onChange(removeMilestone(content, milestone.id))}
              />
            ))}
            {visible.length === 0 && (
              <p
                className="text-muted-foreground pointer-events-none relative px-3 leading-8"
                style={{ height: ROW_HEIGHT }}
              >
                {filtered && content.rows.length > 0
                  ? 'No tasks match these filters.'
                  : 'Drop cards here, or add a task or a row.'}
              </p>
            )}
            {selected && !expanded && extenders}
          </div>
        </div>
      </div>
    </DragStoreContext.Provider>
  )
}

/**
 * Whether a key belongs to this Gantt's selection: not typed into a field, not already handled,
 * and pressed with focus on nothing or inside this Gantt, never over an open view of another one.
 */
function ownsKey(event: KeyboardEvent, root: HTMLElement | null) {
  const target = event.target as HTMLElement | null
  if (!root || event.defaultPrevented) return false
  if (target?.isContentEditable || target?.closest?.('input, textarea, select')) return false
  const open = document.querySelector('[data-module-expanded]')
  if (open && !open.contains(root)) return false
  const scope = root.closest('[data-module-expanded]') ?? root.closest('.react-flow__node') ?? root
  // A key sent to something outside, even after focus left it (a pointer user's key blurs a button).
  if (target instanceof Node && target !== document.body && !scope.contains(target)) return false
  const active = document.activeElement
  return !active || active === document.body || scope.contains(active)
}

/** How a bar's dates relate to the tracker's, for its look and its tooltip. */
function trackerNotes(row: Row, parent: boolean, task: Task | undefined, off: Tracked | null) {
  if (off) return { notes: [`Tracker: ${trackerDates(off)}`] }
  if (!follows(row, parent) || task?.state !== 'ok') return {}
  const tracked = trackerSpan(task)
  if (!tracked) return { notes: ['The tracker has no dates for this task'] }
  const guess = {
    start: 'Start is a guess: the tracker has only a due date',
    end: 'End is a guess: the tracker has only a start date',
  }
  return {
    guess: tracked.guess,
    notes: [tracked.guess ? guess[tracked.guess] : 'Dates from the tracker'],
  }
}

// A little taller than a bar, so its dashes show around one it overlaps.
const GHOST = 'absolute top-[4px] h-[26px] rounded-[5px]'
// The frame's press area: most of the row's height, so the strips above and below a bar are
// easy to hit.
const HIT_TOP = 1
const HIT_HEIGHT = 32
const HIT = 'absolute top-[1px] h-[32px] rounded-[5px]'
// Where a bar or a stage sits in its row; it keeps its own presses.
const BAR_TOP = 6
const BAR_HEIGHT = 22

/** The frame's area less the bar, so the bar and its stages keep every press of their own. */
function aroundBar(width: number, left: number, bar?: { left: number; right: number }) {
  if (!bar) return undefined
  const from = Math.min(Math.max(bar.left - left, 0), width)
  const to = Math.min(Math.max(bar.right - left, 0), width)
  const top = BAR_TOP - HIT_TOP
  const bottom = top + BAR_HEIGHT
  const h = HIT_HEIGHT
  return `polygon(evenodd, 0 0, ${width}px 0, ${width}px ${h}px, 0 ${h}px, 0 0, ${from}px ${top}px, ${from}px ${bottom}px, ${to}px ${bottom}px, ${to}px ${top}px, ${from}px ${top}px)`
}

function ghostBox(tracked: Tracked, axis: Axis) {
  const box = barBox(tracked.span, axis)
  return box && { left: box.left - 2, width: Math.max(box.width, 4) + 4 }
}

/**
 * Where the tracker has the task: a dashed frame over the row, never in the bar's way. The
 * frame around and beyond the bar opens the tracker's dates and a way to follow them; it lies
 * over the row, so Planning's stage drawing does not hide it.
 */
function DriftGhost({
  tracked,
  axis,
  bar,
  onFollow,
  onSpread,
  canSpread,
  parent,
}: {
  tracked: Tracked
  axis: Axis
  bar?: { left: number; right: number }
  onFollow?: () => void
  /** Puts the row's stages into the tracker's dates, in equal shares. */
  onSpread?: () => void
  canSpread: boolean
  /** A parent spans its children; a viewer who cannot edit just reads the dates. */
  parent: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const [open, setOpen] = useState(false)
  const box = ghostBox(tracked, axis)
  if (!box) return null
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Tracker dates: ${trackerDates(tracked)}`}
            className={cn(HIT, 'z-[1] cursor-pointer')}
            style={{ ...box, clipPath: aroundBar(box.width, box.left, bar) }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          />
        </PopoverTrigger>
        <PopoverContent side="top" className="flex w-auto max-w-64 flex-col gap-2 p-3 text-[13px]">
          <p>
            <span className="text-muted-foreground">In the tracker: </span>
            {trackerDates(tracked)}
          </p>
          {onFollow ? (
            <Button size="sm" variant="outline" onClick={onFollow}>
              Follow tracker dates
            </Button>
          ) : onSpread ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={!canSpread}
                onClick={() => {
                  onSpread()
                  setOpen(false)
                }}
              >
                Fit stages to tracker dates
              </Button>
              <p className="text-muted-foreground text-[12px]">
                {canSpread
                  ? 'Stages share the dates equally, then adjust them as you need.'
                  : 'The tracker dates have fewer days than the row has stages.'}
              </p>
            </>
          ) : (
            parent && (
              <p className="text-muted-foreground text-[12px]">
                Rows with children keep their own dates.
              </p>
            )
          )}
        </PopoverContent>
      </Popover>
      {/* The whole frame lights up, over the bar too, wherever the pointer found it. */}
      <span
        aria-hidden
        data-tracker-dates
        className={cn(
          GHOST,
          'border-warning pointer-events-none z-[1] border-[1.5px] border-dashed',
          (hovered || open) && 'bg-warning/15',
          tracked.guess === 'start' && 'border-l-0',
          tracked.guess === 'end' && 'border-r-0',
        )}
        style={box}
      />
    </>
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
  const getZoom = useZoom()
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

function ExtendButton({
  side,
  unit,
  inside,
  disabled,
  onClick,
}: {
  side: 'start' | 'end'
  /** What a click adds, such as "month". */
  unit: string
  /** Within the timeline's edges rather than across them. */
  inside: boolean
  disabled: boolean
  onClick: () => void
}) {
  const label = `Add a ${unit} ${side === 'start' ? 'before' : 'after'}`
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
        side === 'start' ? (inside ? 'left-1' : '-left-3') : inside ? 'right-1' : '-right-3',
      )}
    >
      <Plus className="size-3.5" />
    </Button>
  )
}

function FoldAll({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="nodrag text-muted-foreground size-6 shrink-0"
    >
      {children}
    </Button>
  )
}

function stagesLabel(row: Row, task: Task | undefined) {
  return task?.state === 'ok'
    ? `${keyOf(row, task)} ${task.summary} · ${task.status_name}`
    : keyOf(row, task) || row.title
}

/** The key as the label column shows it: a GitHub task without its owner. */
function keyOf(row: Row, task: Task | undefined) {
  return row.key ? shortKey(task?.source ?? row.source, row.key, task?.type_name) : ''
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
            <DropdownMenuCheckboxItem
              checked={Boolean(content.workingDays)}
              onCheckedChange={(on) => {
                const { workingDays: _working, ...rest } = content
                onChange(on ? { ...content, workingDays: true } : rest)
              }}
            >
              Working days only
            </DropdownMenuCheckboxItem>
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
