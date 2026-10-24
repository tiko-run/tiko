import type { NodeProps } from '@xyflow/react'
import { memo, useContext, useEffect, useState, type ComponentType } from 'react'
import { FarContext } from '@/canvas/readonly'
import { faded, fillCss } from '@/canvas/selection-props'
import { shapePath, textInset } from '@/canvas/shapes'
import { useTask } from '@/canvas/tasks-context'
import type {
  FrameNode,
  ModuleNode,
  ShapeNode,
  StickyNode,
  TaskCardNode,
  TextNode,
} from '@/canvas/types'
import { cn } from '@/lib/utils'

/**
 * A node type drawn as a block when the board is zoomed far out, like Miro below 20%: its
 * outline and color stay, its text turns into grey bars, and it has no grips or editor.
 */
export function farView<P extends NodeProps>(Full: ComponentType<P>, Far: ComponentType<P>) {
  function FarOrFull(props: P) {
    const far = useContext(FarContext)
    // Mounted far out, an element waits for its turn to grow back; mounted close, it is full at once.
    const [full, setFull] = useState(!far)
    useEffect(() => {
      if (far) {
        setFull(false)
        return
      }
      if (full) return
      return upgrade(() => setFull(true))
    }, [far, full])
    return far || !full ? <Far {...props} /> : <Full {...props} />
  }
  FarOrFull.displayName = `FarView(${Full.displayName ?? Full.name})`
  return FarOrFull
}

// Zooming in past the threshold turns hundreds of blocks back into full elements. All in one
// frame that stalls a pinch for a third of a second, so they turn a batch per frame instead.
const BATCH = 60
const waiting = new Set<() => void>()
let frame = 0

function upgrade(grow: () => void): () => void {
  waiting.add(grow)
  if (!frame) frame = requestAnimationFrame(step)
  return () => waiting.delete(grow)
}

function step() {
  frame = 0
  let done = 0
  for (const grow of waiting) {
    waiting.delete(grow)
    grow()
    if (++done === BATCH) break
  }
  if (waiting.size) frame = requestAnimationFrame(step)
}

// One bar for every 30 characters or line, at most three: enough to tell a long note from a short one.
function lines(text: string) {
  if (!text.trim()) return 0
  return Math.min(3, Math.max(text.split('\n').length, Math.ceil(text.length / 30)))
}

const WIDTHS = ['100%', '85%', '60%']

function Bars({ count, className }: { count: number; className?: string }) {
  return Array.from({ length: count }, (_, index) => (
    <span
      key={index}
      className={cn('block h-3 shrink-0 rounded-[3px] bg-current opacity-25', className)}
      style={{ width: count === 1 ? '70%' : WIDTHS[index] }}
    />
  ))
}

export const FarSticky = memo(function FarSticky({ data, selected }: NodeProps<StickyNode>) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col gap-2.5 rounded-md p-3',
        selected && 'ring-primary ring-2',
      )}
      style={{
        background: faded(`var(--sticky-${data.color})`, data.opacity),
        color: faded('var(--sticky-foreground)', data.opacity),
      }}
    >
      <Bars count={lines(data.text)} />
    </div>
  )
})

export const FarShape = memo(function FarShape({
  data,
  selected,
  width = 0,
  height = 0,
}: NodeProps<ShapeNode>) {
  const stroke = data.stroke ?? 1.5
  return (
    <div
      className={cn('relative h-full w-full', selected && 'outline-primary outline-1')}
      style={{
        color:
          data.color === 'none' || data.color === 'surface'
            ? undefined
            : 'var(--sticky-foreground)',
      }}
    >
      <div
        className="absolute inset-0"
        style={{ opacity: data.opacity === undefined ? undefined : data.opacity / 100 }}
      >
        <svg aria-hidden className="absolute inset-0 size-full overflow-visible">
          <path
            d={shapePath(data.shape, width, height)}
            fill={fillCss(data.color)}
            stroke="currentColor"
            strokeWidth={stroke}
            strokeDasharray={data.dash ? `${stroke * 4} ${stroke * 3}` : undefined}
            strokeLinejoin="round"
          />
        </svg>
        {data.text.trim() && (
          <div
            className="absolute flex items-center justify-center"
            style={{ inset: textInset(data.shape) }}
          >
            <Bars count={1} />
          </div>
        )}
      </div>
    </div>
  )
})

export const FarText = memo(function FarText({ data, selected }: NodeProps<TextNode>) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col justify-center gap-2 rounded-sm px-1',
        selected && 'outline-primary outline-1',
      )}
      style={{ color: faded('var(--foreground)', data.opacity) }}
    >
      <Bars count={lines(data.text)} />
    </div>
  )
})

export const FarFrame = memo(function FarFrame({ data, selected }: NodeProps<FrameNode>) {
  const tint =
    data.color && data.color !== 'none'
      ? `color-mix(in oklch, var(--sticky-${data.color}) var(--frame-tint), transparent)`
      : undefined
  const opacity = data.opacity === undefined ? undefined : data.opacity / 100
  return (
    <div
      className={cn('relative h-full w-full rounded-md', selected && 'outline-primary outline-1')}
    >
      <div
        className={cn(
          'absolute inset-0 rounded-md border',
          !tint && 'bg-muted/40',
          selected && !tint && 'bg-accent',
        )}
        style={{ background: tint, opacity }}
      />
      {data.title.trim() && (
        <span
          className="text-muted-foreground absolute bottom-full left-0 mb-1 block h-3 max-w-full rounded-[3px] bg-current opacity-40"
          style={{ width: `${Math.min(data.title.length, 40) * 7}px` }}
        />
      )}
    </div>
  )
})

export const FarModule = memo(function FarModule({ data, selected }: NodeProps<ModuleNode>) {
  return (
    <div
      className={cn(
        'bg-card flex h-full w-full flex-col rounded-md border shadow-sm',
        selected && 'border-primary ring-primary ring-1',
      )}
    >
      <div className="text-muted-foreground flex h-9 shrink-0 items-center border-b px-3">
        <Bars count={data.title?.trim() ? 1 : 0} className="max-w-40" />
      </div>
      <div className="bg-muted/60 m-2 flex-1 rounded-sm" />
    </div>
  )
})

// The lozenge's ink on the light card, its fill on the dark one: whichever stands out.
const STATUS_BAR = {
  new: 'bg-status-new-foreground dark:bg-status-new',
  indeterminate: 'bg-status-progress-foreground dark:bg-status-progress',
  done: 'bg-status-done-foreground dark:bg-status-done',
}

// A card has no size of its own: it keeps the one it was measured at, or a collapsed card's.
export const FarCard = memo(function FarCard({
  data,
  selected,
  width,
  height,
}: NodeProps<TaskCardNode>) {
  const task = useTask(data)
  return (
    <div
      className={cn(
        'bg-card text-muted-foreground flex items-center gap-1.5 rounded-md border px-2',
        selected && 'border-primary ring-primary/30 ring-2',
      )}
      style={{ width: width || 160, height: height || 24 }}
    >
      {task && (
        <span
          className={cn('block h-2 w-7 shrink-0 rounded-[3px]', STATUS_BAR[task.status_category])}
        />
      )}
      <Bars count={1} className="h-2 flex-1" />
    </div>
  )
})
