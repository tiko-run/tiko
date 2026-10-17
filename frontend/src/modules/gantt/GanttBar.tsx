import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState, type PointerEvent } from 'react'
import type { Task } from '@/api/tasks'
import { TypeIcon } from '@/canvas/nodes/TaskBits'
import {
  barBox,
  countDays,
  dragOnAxis,
  dragSpan,
  formatSpan,
  stepDays,
  type Axis,
  type Grip,
  type Span,
} from '@/modules/gantt/timeline'
import { useZoom } from '@/modules/expanded'
import { cn } from '@/lib/utils'

const BAR_COLOR = {
  new: 'bg-status-new text-status-new-foreground',
  indeterminate: 'bg-status-progress text-status-progress-foreground',
  done: 'bg-status-done text-status-done-foreground',
}

type Props = {
  span: Span
  axis: Axis
  label: string
  /** Undefined for a plain row; a task row without data yet is drawn like a plain one. */
  task?: Task
  /** A parent's bar: spans its children and follows them instead of being dragged. */
  summary?: boolean
  onSpan: (span: Span) => void
}

/** A row's bar: drag the body to move it, an end to change that date, in whole days. */
export function GanttBar({ span, axis, label, task, summary, onSpan }: Props) {
  const getZoom = useZoom()
  const drag = useRef<{ x: number; zoom: number; grip: Grip; span: Span } | null>(null)
  const [dragging, setDragging] = useState(false)
  const box = barBox(span, axis)

  if (!box) {
    const before = span.end < axis.range.start
    const Icon = before ? ChevronLeft : ChevronRight
    return (
      <span
        title={before ? 'Before the range' : 'After the range'}
        className={cn('text-muted-foreground absolute top-[9px]', before ? 'left-0' : 'right-0')}
      >
        <Icon className="size-4" />
      </span>
    )
  }

  const start = (grip: Grip) => (event: PointerEvent) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, zoom: getZoom(), grip, span }
    setDragging(true)
  }
  const move = (event: PointerEvent) => {
    const current = drag.current
    if (!current) return
    const steps = Math.round((event.clientX - current.x) / current.zoom / axis.px)
    // A parent moves by calendar days, so its branch keeps its shape over hidden weekends.
    const next =
      steps === 0
        ? current.span
        : summary && current.grip === 'move'
          ? dragSpan(
              current.span,
              'move',
              stepDays(axis, current.span.start, steps) - current.span.start,
            )
          : dragOnAxis(axis, current.span, current.grip, steps)
    if (next.start !== span.start || next.end !== span.end) onSpan(next)
  }
  const stop = () => {
    drag.current = null
    setDragging(false)
  }
  // Grips capture the pointer themselves; their moves bubble up to the bar's handlers.
  const handlers = { onPointerMove: move, onPointerUp: stop, onPointerCancel: stop }

  const missing = task !== undefined && task.state !== 'ok'
  const live = task && !missing
  const content = (
    <>
      {live && (
        <span className="mr-1 opacity-80">
          <TypeIcon typeName={task.type_name} />
        </span>
      )}
      <span className="truncate">{label}</span>
    </>
  )
  // Dates stay off the chart: they show on hover and follow the bar while it is dragged.
  const tip = (
    <DatesTip
      span={span}
      axis={axis}
      note={live ? `${label} · ${task.status_name}` : label}
      shown={dragging}
      left={box.left}
      right={box.left + box.width}
    />
  )

  // A parent keeps its look (a task stays a task) and gains brackets around its children.
  // Moving it takes the whole branch along; its ends stretch but never cut a child off.
  if (summary) {
    return (
      <>
        <div
          role="slider"
          aria-label={`${label} summary`}
          aria-valuetext={formatSpan(span, countDays(axis, span))}
          onPointerDown={start('move')}
          {...handlers}
          className={cn(
            'peer absolute top-[7px] h-5 cursor-grab rounded-[4px] text-[12px] leading-5 font-semibold whitespace-nowrap select-none active:cursor-grabbing',
            live ? BAR_COLOR[task.status_category] : 'bg-foreground/75 text-background',
            task?.status_category === 'done' && 'line-through',
            box.clippedStart && 'rounded-l-none',
            box.clippedEnd && 'rounded-r-none',
          )}
          style={{ left: box.left, width: Math.max(box.width, 4) }}
        >
          <span className="flex h-full items-center overflow-hidden px-1.5">{content}</span>
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

          {!box.clippedStart && (
            <span className="bg-foreground/60 absolute top-full left-0 h-1.5 w-0.5" />
          )}
          {!box.clippedEnd && (
            <span className="bg-foreground/60 absolute top-full right-0 h-1.5 w-0.5" />
          )}
        </div>
        {tip}
      </>
    )
  }

  return (
    <>
      <div
        role="slider"
        aria-label={`${label} dates`}
        aria-valuetext={formatSpan(span, countDays(axis, span))}
        onPointerDown={start('move')}
        {...handlers}
        className={cn(
          'peer absolute top-[7px] flex h-5 cursor-grab items-center overflow-hidden rounded-[4px] px-1.5 text-[12px] leading-5 font-medium whitespace-nowrap select-none active:cursor-grabbing',
          task && !missing
            ? BAR_COLOR[task.status_category]
            : task
              ? 'bg-secondary text-secondary-foreground border'
              : 'bg-card text-card-foreground border',
          missing && 'border-dashed opacity-70',
          task?.status_category === 'done' && 'line-through',
          box.clippedStart && 'rounded-l-none',
          box.clippedEnd && 'rounded-r-none',
        )}
        style={{ left: box.left, width: Math.max(box.width, 4) }}
      >
        {content}
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
      {tip}
    </>
  )
}

// A tip wider than the room right of the bar's start flips to end at the bar's end.
const TIP_ROOM = 240

/** Exact dates of a bar, above it. */
export function DatesTip({
  span,
  axis,
  note,
  shown,
  left,
  right,
  warnings = [],
}: {
  span: Span
  axis: Axis
  note: string
  shown: boolean
  left: number
  right: number
  /** Lines that need attention, such as who is away, under the note. */
  warnings?: string[]
}) {
  const { width } = axis
  const flip = left + TIP_ROOM > width
  return (
    <span
      role="tooltip"
      className={cn(
        'bg-foreground/80 text-background pointer-events-none absolute bottom-[calc(100%-4px)] z-30 hidden max-w-72 flex-col rounded-[4px] px-1.5 py-1 text-[11px] leading-4 whitespace-nowrap peer-hover:flex',
        // While dragging, the bar is compared with the ones above: the tip moves below it,
        // dates only and lighter.
        shown && 'bg-foreground/55 top-[calc(100%-4px)] bottom-auto flex py-0.5',
      )}
      style={flip ? { right: Math.max(width - right, 0) } : { left: Math.max(left, 0) }}
    >
      <span className="font-semibold tabular-nums">{formatSpan(span, countDays(axis, span))}</span>
      {!shown && <span className="truncate opacity-70">{note}</span>}
      {!shown && warnings.map((line) => <span key={line}>{line}</span>)}
    </span>
  )
}
