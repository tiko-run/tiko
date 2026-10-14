import { useStore } from '@xyflow/react'
import {
  ALargeSmall,
  AlarmClock,
  Bold,
  ChevronDown,
  Copy,
  Frame,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  PenLine,
  Shapes,
  StickyNote,
  Ticket,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  fillChoices,
  fillCss,
  fillLabel,
  fillsOf,
  KIND_NAMES,
  kindCounts,
  NO_FILL,
  selectionLabel,
  shares,
  stylesOf,
  type Fill,
  type Kind,
  type Style,
} from '@/canvas/selection-props'
import { STROKES, TEXT_SIZES, type AppNode } from '@/canvas/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
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
  onStyle: (style: Style) => void
  /** A style to show on the selection before it is picked; null takes it back. */
  onPreview: (style: Style | null) => void
  onNarrow: (kind: Kind) => void
  onCollapse: (collapsed: boolean) => void
  /** Set when the selection is one element a timer can attach to. */
  onAddTimer?: () => void
  onDuplicate: () => void
  onDelete: () => void
  /** The selected module's own controls, right after its name. */
  controls?: ReactNode
}

/** One bar for whatever is selected: only the properties every selected element has. */
export function SelectionBar({
  nodes,
  onStyle,
  onPreview,
  onNarrow,
  onCollapse,
  onAddTimer,
  onDuplicate,
  onDelete,
  controls,
}: Props) {
  const box = useScreenBox(nodes.map((n) => n.id))
  // A marquee in progress changes the selection under the bar.
  const selecting = useStore((s) => s.userSelectionActive)
  const bar = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 40 })
  const [open, setOpen] = useState<Menu | null>(null)

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
  const opacities = shares(nodes, 'opacity') ? stylesOf(nodes, 'opacity') : []
  const strokes = shares(nodes, 'stroke') ? stylesOf(nodes, 'stroke') : []
  const dashed = nodes.every((n) => n.type === 'shape' && n.data.dash)
  const sizes = shares(nodes, 'size') ? stylesOf(nodes, 'size') : []
  const bold = shares(nodes, 'bold') ? stylesOf(nodes, 'bold') : []
  const styled = [choices, opacities, strokes, sizes, bold].some((values) => values.length > 0)
  // One value marks its choice as picked; several mark none.
  const only = <T,>(values: T[], value: T) => values.length === 1 && values[0] === value
  const pick = (style: Style) => {
    onPreview(null)
    onStyle(style)
  }
  const popover = (name: Menu) => ({
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
      {controls && (
        <>
          <Divider />
          {controls}
        </>
      )}
      {styled && <Divider />}
      {choices.length > 0 && (
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
                onPointerEnter={() => onPreview({ color: fill })}
                onClick={() => pick({ color: fill })}
                className={cn(
                  'size-5 rounded-full border',
                  fills.length === 1 && fills[0] === fill && 'ring-primary ring-2 ring-offset-1',
                )}
                style={swatch(fill)}
              />
            ))}
          </PopoverContent>
        </Popover>
      )}
      {opacities.length > 0 && (
        <Popover {...popover('opacity')}>
          <PopoverTrigger asChild>
            <Button
              variant={open === 'opacity' ? 'secondary' : 'ghost'}
              className="w-14 px-2 text-xs tabular-nums"
              aria-label="Opacity"
              title="Opacity"
            >
              {opacities.length === 1 ? `${opacities[0]}%` : 'Mixed'}
            </Button>
          </PopoverTrigger>
          <PopoverContent side={side} sideOffset={8} className="w-56 p-3">
            <OpacitySlider
              start={Math.max(...opacities)}
              onSlide={(opacity) => onPreview({ opacity })}
              onPick={(opacity) => pick({ opacity })}
            />
          </PopoverContent>
        </Popover>
      )}
      {strokes.length > 0 && (
        <Popover {...popover('outline')}>
          <PopoverTrigger asChild>
            <Button
              variant={open === 'outline' ? 'secondary' : 'ghost'}
              size="icon"
              aria-label="Outline"
              title="Outline"
            >
              <PenLine className="size-[18px]" strokeWidth={1.75} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side={side}
            sideOffset={8}
            className="w-auto flex-row items-center gap-0.5 p-1"
            onPointerLeave={() => onPreview(null)}
          >
            {STROKES.map((stroke) => (
              <Choice
                key={stroke}
                label={`${stroke}px outline`}
                pressed={only(strokes, stroke)}
                onPreview={() => onPreview({ stroke })}
                onPick={() => pick({ stroke })}
              >
                <Line width={stroke} />
              </Choice>
            ))}
            <Divider />
            <Choice
              label="Dashed"
              pressed={dashed}
              onPreview={() => onPreview({ dash: !dashed })}
              onPick={() => pick({ dash: !dashed })}
            >
              <Line width={1.5} dashed />
            </Choice>
          </PopoverContent>
        </Popover>
      )}
      {sizes.length > 0 && (
        <Popover {...popover('size')}>
          <PopoverTrigger asChild>
            <Button
              variant={open === 'size' ? 'secondary' : 'ghost'}
              size="icon"
              aria-label="Text size"
              title="Text size"
            >
              <ALargeSmall className="size-[18px]" strokeWidth={1.75} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side={side}
            sideOffset={8}
            className="w-32 gap-0 p-1"
            onPointerLeave={() => onPreview(null)}
          >
            {TEXT_SIZES.map((size) => (
              <Choice
                key={size}
                label={SIZE_NAMES[size]}
                pressed={only(sizes, size)}
                onPreview={() => onPreview({ size })}
                onPick={() => pick({ size })}
                wide
              >
                {SIZE_NAMES[size]}
              </Choice>
            ))}
          </PopoverContent>
        </Popover>
      )}
      {bold.length > 0 && (
        <Button
          variant={only(bold, true) ? 'secondary' : 'ghost'}
          size="icon"
          aria-label="Bold"
          title="Bold"
          aria-pressed={only(bold, true)}
          onClick={() => pick({ bold: !only(bold, true) })}
        >
          <Bold className="size-[18px]" strokeWidth={only(bold, true) ? 2.5 : 1.75} />
        </Button>
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

const SIZE_NAMES = { small: 'Small', medium: 'Medium', large: 'Large' } as const

type Menu = 'filter' | 'fill' | 'opacity' | 'outline' | 'size'

// The slider moves the selection for this person only; letting go saves it as one undo step.
function OpacitySlider({
  start,
  onSlide,
  onPick,
}: {
  start: number
  onSlide: (opacity: number) => void
  onPick: (opacity: number) => void
}) {
  const [value, setValue] = useState(start)
  // An undo while the popover is open moves the selection under the slider.
  const [was, setWas] = useState(start)
  if (start !== was) {
    setWas(start)
    setValue(start)
  }
  return (
    <div className="flex items-center gap-3">
      <Slider
        aria-label="Opacity"
        min={10}
        max={100}
        step={5}
        value={[value]}
        onValueChange={([next]) => {
          setValue(next)
          onSlide(next)
        }}
        onValueCommit={([next]) => onPick(next)}
      />
      <span className="text-muted-foreground w-9 text-right text-xs tabular-nums">{value}%</span>
    </div>
  )
}

function Choice({
  label,
  pressed,
  onPreview,
  onPick,
  wide = false,
  children,
}: {
  label: string
  pressed: boolean
  onPreview: () => void
  onPick: () => void
  /** A word instead of an icon. */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <Button
      variant={pressed ? 'secondary' : 'ghost'}
      size={wide ? 'default' : 'icon'}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onPointerEnter={onPreview}
      onClick={onPick}
      className={cn(wide && 'justify-start px-2 font-normal')}
    >
      {children}
    </Button>
  )
}

const Line = ({ width, dashed = false }: { width: number; dashed?: boolean }) => (
  <svg aria-hidden width="18" height="18" viewBox="0 0 18 18">
    <path
      d="M2 9H16"
      stroke="currentColor"
      strokeWidth={width}
      strokeDasharray={dashed ? '3 2.5' : undefined}
    />
  </svg>
)

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
