import { X } from 'lucide-react'
import { useRef, type PointerEvent } from 'react'
import { linkConflict, linkPath, type Link } from '@/modules/gantt/plan'
import { HEADER, ROW_HEIGHT } from '@/modules/gantt/rows'
import type { Span } from '@/modules/gantt/timeline'
import { useZoom } from '@/modules/expanded'
import { cn } from '@/lib/utils'

/** A visible row's bar in timeline pixels, below the header. */
export type BarPlace = { left: number; right: number; y: number; span: Span }

export type Point = { x: number; y: number }

type Props = {
  links: Link[]
  bars: Map<string, BarPlace>
  /** The line being drawn from a bar's connect handle. */
  wire: { from: Point; to: Point } | null
  picked: string | null
  onPick: (id: string | null) => void
  onRemove: (id: string) => void
  rowHeight: number
}

/** Dependency lines over the rows; a conflicting one is drawn in the warning color. */
export function Links({ links, bars, wire, picked, onPick, onRemove, rowHeight }: Props) {
  const lines = links.flatMap((link) => {
    const from = bars.get(link.from)
    const to = bars.get(link.to)
    if (!from || !to) return []
    const path = linkPath(from.right, from.y, to.left, to.y, rowHeight)
    const arrow = `M ${to.left - 6} ${to.y - 3.5} L ${to.left} ${to.y} L ${to.left - 6} ${to.y + 3.5} z`
    return [{ link, ...path, arrow, conflict: linkConflict(from.span, to.span) }]
  })
  const chosen = lines.find((line) => line.link.id === picked)

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-x-0 z-10 overflow-visible"
        style={{ top: HEADER, height: 1 }}
      >
        {lines.map(({ link, d, arrow, conflict }) => (
          <g
            key={link.id}
            data-testid="gantt-link"
            data-conflict={conflict || undefined}
            className={cn(
              conflict ? 'text-warning' : 'text-foreground/55',
              link.id === picked && !conflict && 'text-primary',
            )}
          >
            <path
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={link.id === picked ? 2 : 1.25}
            />
            <path d={arrow} fill="currentColor" />
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={10}
              tabIndex={0}
              role="button"
              aria-label={conflict ? 'Dependency, starts too early' : 'Dependency'}
              className="cursor-pointer outline-none"
              style={{ pointerEvents: 'stroke' }}
              onPointerDown={(event) => {
                event.stopPropagation()
                onPick(link.id === picked ? null : link.id)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Delete' && event.key !== 'Backspace') return
                // The board would delete the whole module on these keys.
                event.stopPropagation()
                onRemove(link.id)
              }}
            />
          </g>
        ))}
        {wire && (
          <path
            d={`M ${wire.from.x} ${wire.from.y} L ${wire.to.x} ${wire.to.y}`}
            className="text-primary"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}
      </svg>
      {chosen && (
        <button
          type="button"
          aria-label="Remove the dependency"
          title="Remove the dependency"
          onClick={() => onRemove(chosen.link.id)}
          className="bg-card text-muted-foreground hover:text-foreground absolute z-20 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm"
          style={{ left: chosen.mid.x, top: HEADER + chosen.mid.y }}
        >
          <X className="size-3" />
        </button>
      )}
    </>
  )
}

/** Dot past a bar's end: drag it onto another row to make that row wait for this one. */
export function ConnectHandle({
  bar,
  onWire,
  onDrop,
}: {
  bar: BarPlace
  onWire: (wire: { from: Point; to: Point } | null) => void
  onDrop: (target: Element | null) => void
}) {
  const getZoom = useZoom()
  const drag = useRef<{ x: number; y: number; zoom: number } | null>(null)
  const from = { x: bar.right, y: bar.y }
  const point = (event: PointerEvent, start: { x: number; y: number; zoom: number }) => ({
    x: from.x + (event.clientX - start.x) / start.zoom,
    y: from.y + (event.clientY - start.y) / start.zoom,
  })
  return (
    <span
      role="button"
      aria-label="Drag to another task to link it"
      title="Drag to another task: it starts after this one"
      onPointerDown={(event) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, y: event.clientY, zoom: getZoom() }
      }}
      onPointerMove={(event) => {
        if (drag.current) onWire({ from, to: point(event, drag.current) })
      }}
      onPointerUp={(event) => {
        if (!drag.current) return
        drag.current = null
        onWire(null)
        const hit = document.elementFromPoint(event.clientX, event.clientY)
        const body = event.currentTarget.closest('[data-gantt-body]')
        onDrop(hit?.closest('[data-gantt-body]') === body ? hit : null)
      }}
      onPointerCancel={() => {
        drag.current = null
        onWire(null)
      }}
      className="border-primary bg-card absolute z-20 size-2.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 opacity-0 group-hover/row:opacity-100"
      style={{ left: bar.right + 3, top: ROW_HEIGHT / 2 }}
    />
  )
}
