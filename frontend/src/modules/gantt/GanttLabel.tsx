import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GripVertical,
  ListIndentDecrease,
  ListIndentIncrease,
  ListPlus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useContext, useRef, useState, type PointerEvent } from 'react'
import type { Task } from '@/api/tasks'
import { TypeIcon } from '@/canvas/nodes/TaskBits'
import type { Row } from '@/modules/gantt/rows'
import { useZoom } from '@/modules/expanded'
import { cn } from '@/lib/utils'
import { BoardSourcesContext } from '@/sources/board-sources'
import { shortKey, sourceName } from '@/sources/registry'
import { BoardSourceMark } from '@/sources/SourceMark'
import { useTaskLinkProps } from '@/lib/task-links'
import { useReadOnly } from '@/canvas/readonly'

// A press that moves further than this starts a row drag.
const DRAG_SLOP = 4
// One tree level, in label pixels and in drag distance.
export const INDENT = 16

type Props = {
  row: Row
  depth: number
  hasChildren: boolean
  height: number
  task?: Task
  /** Where the task opens in the tracker; only from its own button, never from a drag. */
  url?: string
  /** A row just added by the user opens with its title in edit mode. */
  fresh?: boolean
  onTitle: (title: string) => void
  onRemove: () => void
  onToggle: () => void
  onIndent: () => void
  onOutdent: () => void
  onAddChild: () => void
  /** Dropped inside the module: how many rows down and levels right it moved. */
  onMove: (rows: number, levels: number) => void
  /** Dropped outside the module, at this screen point. */
  onEject: (screen: { x: number; y: number }) => void
}

/** The row's label: drag it to reorder, or out of the module to put it back on the board. */
export function GanttLabel({
  row,
  depth,
  hasChildren,
  height,
  task,
  url,
  fresh,
  onTitle,
  onRemove,
  onToggle,
  onIndent,
  onOutdent,
  onAddChild,
  onMove,
  onEject,
}: Props) {
  const getZoom = useZoom()
  const readOnly = useReadOnly()
  const linkProps = useTaskLinkProps()
  const { mixed } = useContext(BoardSourcesContext)
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(Boolean(fresh))
  const press = useRef<{ x: number; y: number; zoom: number } | null>(null)

  const down = (event: PointerEvent) => {
    if ((event.target as Element).closest('a, button, input')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    press.current = { x: event.clientX, y: event.clientY, zoom: getZoom() }
  }
  const move = (event: PointerEvent) => {
    const start = press.current
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (offset === null && Math.hypot(dx, dy) < DRAG_SLOP) return
    setOffset({ x: dx / start.zoom, y: dy / start.zoom })
  }
  const up = (event: PointerEvent) => {
    const start = press.current
    press.current = null
    if (!start || offset === null) return
    setOffset(null)
    const target = event.currentTarget as Element
    const expandedView = target.closest('[data-module-expanded]')
    const box = (expandedView ?? target.closest('.react-flow__node'))?.getBoundingClientRect()
    const inside =
      box &&
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    // The board is out of reach behind an expanded module, so a row is not ejected from there.
    if (!inside && expandedView) return
    if (!inside) return onEject({ x: event.clientX, y: event.clientY })
    onMove(Math.round(offset.y / height), Math.round(offset.x / INDENT))
  }

  const done = task?.status_category === 'done'
  const name = row.key ?? (row.title || 'row')
  return (
    <div
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        press.current = null
        setOffset(null)
      }}
      // The press captures the pointer, so the double-click lands here and not on the title.
      onDoubleClick={(event) => {
        if (!row.key && !(event.target as Element).closest('a, button, input')) setEditing(true)
      }}
      className={cn(
        'group/label flex cursor-grab items-center gap-1 border-b border-border/60 pr-1 select-none',
        offset !== null && 'bg-card relative z-10 cursor-grabbing shadow-md',
      )}
      style={{
        height,
        paddingLeft: 4 + depth * INDENT,
        transform: offset !== null ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
      }}
    >
      {/* The mark takes the grip's place until hover, so the title keeps its room. */}
      {mixed && row.key && (
        <span className="flex shrink-0 group-hover/label:hidden">
          <BoardSourceMark source={task?.source ?? row.source} />
        </span>
      )}
      <GripVertical
        className={cn(
          'text-muted-foreground/60 size-3.5 shrink-0',
          mixed && row.key && 'hidden group-hover/label:block',
        )}
      />
      {hasChildren ? (
        <button
          type="button"
          aria-label={`${row.collapsed ? 'Expand' : 'Collapse'} ${name}`}
          aria-expanded={!row.collapsed}
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground -mx-0.5 shrink-0 rounded-sm"
        >
          {row.collapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
      ) : (
        <span className="w-2.5 shrink-0" />
      )}
      {row.key ? (
        <span
          className={cn(
            'flex min-w-0 items-center gap-1',
            done && 'text-muted-foreground',
            hasChildren && 'font-semibold',
          )}
        >
          {task && task.state !== 'private' && <TypeIcon typeName={task.type_name} />}
          {/* A viewer has no hover actions, so the key itself opens the task. */}
          {readOnly && url ? (
            <a
              href={url}
              {...linkProps}
              className={cn(
                'pointer-events-auto shrink-0 font-medium hover:underline',
                done && 'line-through',
              )}
            >
              {shortKey(task?.source ?? row.source, row.key)}
            </a>
          ) : (
            <span className={cn('shrink-0 font-medium', done && 'line-through')}>
              {shortKey(task?.source ?? row.source, row.key)}
            </span>
          )}
          <span className="truncate" title={task?.summary}>
            {task?.state === 'not_found'
              ? 'not found'
              : task?.state === 'no_token'
                ? `connect your ${sourceName(task.source)} token`
                : task?.summary}
          </span>
        </span>
      ) : editing ? (
        <input
          autoFocus
          defaultValue={row.title}
          maxLength={200}
          aria-label="Row title"
          className="bg-background min-w-0 flex-1 rounded-sm border px-1 outline-none"
          onBlur={(event) => {
            setEditing(false)
            if (event.target.value !== row.title) onTitle(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span
          className={cn(
            'truncate',
            !row.title && 'text-muted-foreground',
            hasChildren && 'font-semibold',
          )}
        >
          {row.title || 'Untitled'}
        </span>
      )}
      <span className="bg-panel ml-auto hidden shrink-0 items-center group-hover/label:flex">
        {url && <RowAction label={`Open ${name} in the tracker`} Icon={ExternalLink} href={url} />}
        <RowAction label={`Add a task under ${name}`} Icon={ListPlus} onClick={onAddChild} />
        {depth > 0 && (
          <RowAction label={`Outdent ${name}`} Icon={ListIndentDecrease} onClick={onOutdent} />
        )}
        <RowAction label={`Indent ${name}`} Icon={ListIndentIncrease} onClick={onIndent} />
        <RowAction label={`Remove ${name}`} Icon={X} onClick={onRemove} />
      </span>
    </div>
  )
}

function RowAction({
  label,
  Icon,
  onClick,
  href,
}: {
  label: string
  Icon: LucideIcon
  onClick?: () => void
  href?: string
}) {
  const className = 'text-muted-foreground hover:text-foreground rounded-sm p-0.5'
  const linkProps = useTaskLinkProps()
  if (href) {
    return (
      <a href={href} {...linkProps} aria-label={label} title={label} className={className}>
        <Icon className="size-3.5" />
      </a>
    )
  }
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={className}>
      <Icon className="size-3.5" />
    </button>
  )
}
