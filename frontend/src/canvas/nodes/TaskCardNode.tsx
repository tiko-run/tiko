import { useOnViewportChange, useReactFlow, type NodeProps } from '@xyflow/react'
import { memo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useTask } from '@/canvas/tasks-context'
import type { TaskCardNode as TaskCardNodeType } from '@/canvas/types'
import { CardDetails } from '@/canvas/nodes/CardDetails'
import { Handles } from '@/canvas/nodes/Handles'
import { Reactions } from '@/canvas/nodes/Reactions'
import { useInVote } from '@/voting/useVoting'
import { VoteControl } from '@/voting/VoteControl'
import { StatusLozenge, TypeIcon } from '@/canvas/nodes/TaskBits'
import { openSettings } from '@/settings/store'
import { credentialName, shortKey, sourceName } from '@/sources/registry'
import { BoardSourceMark } from '@/sources/SourceMark'
import { useTaskLinkProps } from '@/lib/task-links'

// Long titles are cut so the status lozenge after them always stays visible.
const SUMMARY_LIMIT = 120
// A press that moves further than this is a drag, not a click that opens the mini-card.
const CLICK_SLOP = 4

function clip(text: string) {
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT).trimEnd()}…` : text
}

function TaskCardNodeView({ id, data, selected }: NodeProps<TaskCardNodeType>) {
  const task = useTask(data)
  const linkProps = useTaskLinkProps()
  const { updateNodeData } = useReactFlow()
  const [open, setOpen] = useState(false)
  const pressedAt = useRef<{ x: number; y: number } | null>(null)
  const noToken = task?.state === 'no_token'
  // Its tracker is not connected here, as on a board imported from another tiko.
  const notConnected = task?.state === 'not_connected'
  // On a public board a guest gets the key and its link, nothing else.
  const hidden = task?.state === 'private'
  const missing = task?.state === 'not_found' || noToken || notConnected || hidden
  const done = task?.status_category === 'done'
  const collapsed = Boolean(data.collapsed)
  const inVote = useInVote(id)

  // The popover is anchored in screen space and would drift away from a panned card.
  useOnViewportChange({ onStart: () => setOpen(false) })

  const onPointerDown = (event: PointerEvent) => {
    pressedAt.current = { x: event.clientX, y: event.clientY }
  }
  const onClick = (event: MouseEvent) => {
    const start = pressedAt.current
    if (!task || missing || !start) return
    // Shift-click extends the selection, and the key link goes straight to the tracker.
    if (event.shiftKey || (event.target as Element).closest('a')) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return
    setOpen(true)
  }

  // One inline flow, like Confluence's issue macro: wrapped lines start at the left edge.
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            onPointerDown={onPointerDown}
            onClick={onClick}
            className={cn(
              'bg-card text-card-foreground w-max max-w-80 rounded-md border px-2 text-[13px] leading-5',
              collapsed ? 'py-px' : 'py-1',
              selected && 'border-primary ring-primary/30 ring-2',
            )}
          >
            <BoardSourceMark source={task?.source ?? data.source} className="mr-1.5 align-[-2px]" />
            {task && !hidden && (
              <span className="text-muted-foreground mr-1.5 inline-block align-[-2px]">
                <TypeIcon typeName={task.type_name} />
              </span>
            )}
            {collapsed && !hidden ? (
              // Collapsed, the whole card is the click target for the mini-card.
              <span
                className={cn(
                  'text-primary mr-1.5 font-mono text-xs tabular-nums',
                  done && 'line-through',
                )}
              >
                {shortKey(task?.source ?? data.source, data.key, task?.type_name)}
              </span>
            ) : (
              <a
                href={task?.url || undefined}
                {...linkProps}
                className={cn(
                  'text-primary font-mono text-xs tabular-nums hover:underline',
                  !hidden && 'mr-1.5',
                  done && 'line-through',
                )}
              >
                {shortKey(task?.source ?? data.source, data.key, task?.type_name)}
              </a>
            )}
            {!task && <span className="text-muted-foreground">Loading…</span>}
            {task?.state === 'not_found' && (
              <span className="text-muted-foreground">Not found or no access</span>
            )}
            {(noToken || notConnected) && task.summary && !collapsed && (
              // What was last seen of the task, until its tracker can be asked again.
              <span className="text-muted-foreground mr-1.5">{clip(task.summary)}</span>
            )}
            {notConnected && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                onClick={() => openSettings('task-source')}
              >
                {sourceName(task.source)} is not connected here
              </button>
            )}
            {noToken && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                onClick={() => openSettings('tracker')}
              >
                Connect your {sourceName(task.source)} {credentialName(task.source)} to see this
                task
              </button>
            )}
            {task && !missing && (
              <>
                {!collapsed && (
                  <span className={cn('mr-1.5', done && 'text-muted-foreground')}>
                    {clip(task.summary)}
                  </span>
                )}
                <StatusLozenge task={task} />
              </>
            )}
            <Handles />
          </div>
        </PopoverAnchor>
        {task && !missing && (
          <PopoverContent align="start" className="w-80 p-3">
            <CardDetails
              task={task}
              collapsed={collapsed}
              onToggleCollapsed={() => {
                // A card in a running vote keeps its look until the end.
                if (!inVote) updateNodeData(id, { collapsed: !collapsed })
                setOpen(false)
              }}
            />
          </PopoverContent>
        )}
      </Popover>
      <Reactions id={id} data={data} />
      <VoteControl id={id} />
    </>
  )
}

export const TaskCardNode = memo(TaskCardNodeView)
