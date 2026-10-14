import { useStore } from '@xyflow/react'
import {
  AlarmClock,
  ChevronDown,
  Copy,
  Frame,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  Shapes,
  StickyNote,
  Ticket,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  fillChoices,
  fillCss,
  fillLabel,
  fillsOf,
  KIND_NAMES,
  kindCounts,
  NO_FILL,
  selectionLabel,
  type Fill,
  type Kind,
} from '@/canvas/selection-props'
import type { AppNode } from '@/canvas/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { withShortcut } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

const KIND_ICONS: Record<Kind, LucideIcon> = {
  task_card: Ticket,
  frame: Frame,
  sticky: StickyNote,
  shape: Shapes,
  text: Type,
  module: LayoutTemplate,
  timer: AlarmClock,
}

const GAP = 12
const EDGE = 8
// The top bar and the toolbar keep their strips of the window.
const TOP_CLEAR = 64
const BOTTOM_CLEAR = 64

type Box = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

// The box around the nodes on screen, with the size of the canvas; a string, so it compares by value.
function useScreenBox(ids: string[]): Box | null {
  const key = useStore((s) => {
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const id of ids) {
      const node = s.nodeLookup.get(id)
      if (!node) continue
      const { x, y } = node.internals.positionAbsolute
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x + (node.measured.width ?? node.width ?? 0))
      bottom = Math.max(bottom, y + (node.measured.height ?? node.height ?? 0))
    }
    if (left === Infinity) return ''
    const [tx, ty, zoom] = s.transform
    return [
      left * zoom + tx,
      top * zoom + ty,
      right * zoom + tx,
      bottom * zoom + ty,
      s.width,
      s.height,
    ]
      .map(Math.round)
      .join(' ')
  })
  if (!key) return null
  const [left, top, right, bottom, width, height] = key.split(' ').map(Number)
  return { left, top, right, bottom, width, height }
}

const swatch = (fill: Fill) => ({ background: fill === 'none' ? NO_FILL : fillCss(fill) })
const Divider = () => <span aria-hidden className="bg-border mx-0.5 h-5 w-px" />

type Props = {
  /** The selected elements, without anchors. */
  nodes: AppNode[]
  onFill: (fill: Fill) => void
  /** A fill to show on the selection before it is picked; null takes it back. */
  onPreview: (fill: Fill | null) => void
  onNarrow: (kind: Kind) => void
  onCollapse: (collapsed: boolean) => void
  /** Set when the selection is one element a timer can attach to. */
  onAddTimer?: () => void
  onDuplicate: () => void
  onDelete: () => void
}

/** One bar for whatever is selected: only the properties every selected element has. */
export function SelectionBar({
  nodes,
  onFill,
  onPreview,
  onNarrow,
  onCollapse,
  onAddTimer,
  onDuplicate,
  onDelete,
}: Props) {
  const box = useScreenBox(nodes.map((n) => n.id))
  // A marquee in progress changes the selection under the bar.
  const selecting = useStore((s) => s.userSelectionActive)
  const bar = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 40 })
  const [open, setOpen] = useState<'filter' | 'fill' | null>(null)

  const mounted = box !== null && !selecting
  // Its own size places it: the bar grows and shrinks with what the selection shares.
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const measure = () =>
      setSize((was) =>
        was.width === el.offsetWidth && was.height === el.offsetHeight
          ? was
          : { width: el.offsetWidth, height: el.offsetHeight },
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [mounted])
  useEffect(() => () => onPreview(null), [onPreview])

  if (!mounted) return null
  // A selection scrolled out of sight takes its bar along.
  const laidOut = box.width > 0 && box.height > 0
  if (laidOut && (box.right < 0 || box.bottom < 0 || box.left > box.width || box.top > box.height))
    return null

  const above = box.top - GAP - size.height >= TOP_CLEAR
  const top = above
    ? box.top - GAP - size.height
    : Math.max(TOP_CLEAR, Math.min(box.bottom + GAP, box.height - BOTTOM_CLEAR - size.height))
  const half = size.width / 2
  const center = (box.left + box.right) / 2
  const left = laidOut ? Math.max(EDGE + half, Math.min(center, box.width - EDGE - half)) : center

  const kinds = kindCounts(nodes)
  const choices = fillChoices(nodes)
  const fills = fillsOf(nodes)
  const cards = nodes.filter((n) => n.type === 'task_card')
  const expanded = cards.filter((n) => !n.data.collapsed).length
  const popover = (name: 'filter' | 'fill') => ({
    open: open === name,
    onOpenChange: (next: boolean) => {
      setOpen(next ? name : null)
      if (!next) onPreview(null)
    },
  })
  // Away from the selection, so a popover never covers what it changes.
  const side = above ? 'top' : 'bottom'
  const KindIcon = KIND_ICONS[kinds[0].kind]

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Selection"
      className="bg-card absolute z-10 flex w-max -translate-x-1/2 flex-wrap items-center justify-center gap-0.5 rounded-lg border p-1 shadow-md"
      // A canvas narrower than the bar wraps it instead of pushing controls off screen.
      style={{ left, top, maxWidth: laidOut ? box.width - 2 * EDGE : undefined }}
    >
      {kinds.length === 1 ? (
        <span className="text-muted-foreground flex items-center gap-1.5 px-2 text-xs whitespace-nowrap">
          <KindIcon className="size-4" strokeWidth={1.75} />
          {selectionLabel(nodes)}
        </span>
      ) : (
        <Popover {...popover('filter')}>
          <PopoverTrigger asChild>
            <Button
              variant={open === 'filter' ? 'secondary' : 'ghost'}
              className="gap-1 px-2 text-xs"
              aria-label={`Filter ${selectionLabel(nodes)}`}
            >
              {selectionLabel(nodes)}
              <ChevronDown className="size-3.5" strokeWidth={1.75} />
            </Button>
          </PopoverTrigger>
          <PopoverContent side={side} sideOffset={8} align="start" className="w-48 gap-0 p-1">
            {kinds.map(({ kind, count }) => {
              const Icon = KIND_ICONS[kind]
              return (
                <Button
                  key={kind}
                  variant="ghost"
                  className="justify-start gap-2 px-2 font-normal"
                  onClick={() => {
                    setOpen(null)
                    onNarrow(kind)
                  }}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                  {KIND_NAMES[kind][1]}
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {count}
                  </span>
                </Button>
              )
            })}
          </PopoverContent>
        </Popover>
      )}
      {choices.length > 0 && (
        <>
          <Divider />
          <Popover {...popover('fill')}>
            <PopoverTrigger asChild>
              <Button
                variant={open === 'fill' ? 'secondary' : 'ghost'}
                size="icon"
                aria-label="Fill"
                title="Fill"
              >
                <span className="flex">
                  {fills.slice(0, 3).map((fill) => (
                    <span
                      key={fill}
                      className="-ml-2 size-4 rounded-full border first:ml-0"
                      style={swatch(fill)}
                    />
                  ))}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side={side}
              sideOffset={8}
              className="w-auto flex-row gap-1 p-1.5"
              onPointerLeave={() => onPreview(null)}
            >
              {choices.map((fill) => (
                <button
                  key={fill}
                  type="button"
                  aria-label={fillLabel(fill)}
                  title={fillLabel(fill)}
                  aria-pressed={fills.length === 1 && fills[0] === fill}
                  onPointerEnter={() => onPreview(fill)}
                  onClick={() => {
                    onPreview(null)
                    onFill(fill)
                  }}
                  className={cn(
                    'size-5 rounded-full border',
                    fills.length === 1 && fills[0] === fill && 'ring-primary ring-2 ring-offset-1',
                  )}
                  style={swatch(fill)}
                />
              ))}
            </PopoverContent>
          </Popover>
        </>
      )}
      {cards.length === nodes.length && (
        <>
          <Divider />
          <IconButton
            Icon={expanded > 0 ? Minimize2 : Maximize2}
            label={`${expanded > 0 ? 'Collapse' : 'Expand'} ${cards.length > 1 ? 'cards' : 'card'}`}
            onClick={() => onCollapse(expanded > 0)}
          />
        </>
      )}
      <Divider />
      {onAddTimer && <IconButton Icon={AlarmClock} label="Add timer" onClick={onAddTimer} />}
      <IconButton
        Icon={Copy}
        label="Duplicate"
        title={withShortcut('duplicate')}
        onClick={onDuplicate}
      />
      <IconButton Icon={Trash2} label="Delete" onClick={onDelete} />
    </div>
  )
}

function IconButton({
  Icon,
  label,
  title = label,
  onClick,
}: {
  Icon: LucideIcon
  label: string
  title?: string
  onClick: () => void
}) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={title} onClick={onClick}>
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </Button>
  )
}
