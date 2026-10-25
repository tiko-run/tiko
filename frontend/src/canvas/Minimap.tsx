import {
  Panel,
  useReactFlow,
  useStore,
  useStoreApi,
  type InternalNode,
  type ReactFlowState,
} from '@xyflow/react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { reducedMotion } from '@/canvas/fly'
import { fillCss, fillOf } from '@/canvas/selection-props'
import type { AppNode } from '@/canvas/types'
import { useTheme } from '@/lib/theme'
import { boundsOf, fit, HEIGHT, WIDTH, type Rect } from '@/canvas/minimap-fit'

const KEY = 'tiko.minimap'

export function readMinimapShown(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'hidden'
  } catch {
    return true
  }
}

export function saveMinimapShown(shown: boolean) {
  try {
    localStorage.setItem(KEY, shown ? 'shown' : 'hidden')
  } catch {
    // Keep the choice for this visit only.
  }
}

/** The block an element draws on the minimap; anchors and timers draw nothing. */
export function minimapLook(node: AppNode): { fill: string; stroke: string } {
  const none = { fill: 'transparent', stroke: 'transparent' }
  switch (node.type) {
    case 'sticky':
    case 'shape': {
      const fill = fillOf(node)
      if (!fill || fill === 'none')
        return { fill: 'transparent', stroke: 'var(--muted-foreground)' }
      return { fill: fillCss(fill), stroke: 'transparent' }
    }
    case 'frame':
      return { fill: 'transparent', stroke: 'var(--muted-foreground)' }
    case 'task_card':
    case 'module':
      return { fill: 'var(--muted-foreground)', stroke: 'transparent' }
    case 'text':
      return { fill: 'var(--border)', stroke: 'transparent' }
    default:
      return none
  }
}

// Elements are redrawn at most this often: a big board costs a pass over every element.
const REDRAW_MS = 200
// A press that moves less than this is a click, not a drag of the frame.
const CLICK_PX = 3

type Drawing = { bounds: Rect; scale: number }

function boxOf(node: InternalNode<AppNode>): Rect | null {
  const user = node.internals.userNode
  const width = user.measured?.width ?? user.width ?? user.initialWidth
  const height = user.measured?.height ?? user.height ?? user.initialHeight
  if (user.hidden || !width || !height) return null
  const { x, y } = node.internals.positionAbsolute
  return { x, y, width, height }
}

// Canvas takes colors, not CSS variables: each `var(--name)` is read from the page.
function resolver(element: Element) {
  const style = getComputedStyle(element)
  const cache = new Map<string, string>()
  return (color: string) => {
    const name = /^var\((--[\w-]+)\)$/.exec(color)?.[1]
    if (!name) return color
    let value = cache.get(name)
    if (value === undefined) cache.set(name, (value = style.getPropertyValue(name).trim()))
    return value
  }
}

/** Draws every element on the canvas and says where the drawing sits on the board. */
function paint(canvas: HTMLCanvasElement, nodes: Iterable<InternalNode<AppNode>>): Drawing | null {
  const items: { box: Rect; node: AppNode }[] = []
  for (const node of nodes) {
    const box = boxOf(node)
    if (box) items.push({ box, node: node.internals.userNode })
  }
  const bounds = boundsOf(items.map((item) => item.box))
  const context = canvas.getContext('2d')
  if (!bounds || !context) return null
  const ratio = window.devicePixelRatio || 1
  const scale = Math.min(WIDTH / bounds.width, HEIGHT / bounds.height) * ratio
  canvas.width = Math.max(1, Math.ceil(bounds.width * scale))
  canvas.height = Math.max(1, Math.ceil(bounds.height * scale))
  const color = resolver(canvas)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.lineWidth = ratio
  for (const { box, node } of items) {
    const { fill, stroke } = minimapLook(node)
    const x = (box.x - bounds.x) * scale
    const y = (box.y - bounds.y) * scale
    const w = Math.max(box.width * scale, ratio)
    const h = Math.max(box.height * scale, ratio)
    if (fill !== 'transparent') {
      context.globalAlpha = fill === 'var(--muted-foreground)' ? 0.45 : 1
      context.fillStyle = color(fill)
      context.fillRect(x, y, w, h)
    }
    if (stroke !== 'transparent') {
      context.globalAlpha = 1
      context.strokeStyle = color(stroke)
      // Outlines stay one screen pixel however large the board is.
      context.strokeRect(x + ratio / 2, y + ratio / 2, w - ratio, h - ratio)
    }
  }
  context.globalAlpha = 1
  return { bounds, scale: scale / ratio }
}

type View = { x: number; y: number; zoom: number; width: number; height: number }
const viewOf = (s: ReactFlowState): View => ({
  x: s.transform[0],
  y: s.transform[1],
  zoom: s.transform[2],
  width: s.width,
  height: s.height,
})
const sameView = (a: View, b: View) =>
  a.x === b.x && a.y === b.y && a.zoom === b.zoom && a.width === b.width && a.height === b.height
const nodesOf = (s: ReactFlowState) => s.nodes

/**
 * The whole board in the corner: a click moves the view there, dragging the frame pans.
 *
 * Elements are painted on one canvas, a few times a second at most, and only when they change.
 * Panning and zooming move the drawing and the frame, without a pass over the elements.
 */
export function Minimap() {
  const flow = useReactFlow()
  const store = useStoreApi<AppNode>()
  const theme = useTheme().resolved
  const nodes = useStore(nodesOf)
  const view = useStore(viewOf, sameView)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const last = useRef(0)

  useEffect(() => {
    const draw = () => {
      last.current = performance.now()
      if (canvas.current) setDrawing(paint(canvas.current, store.getState().nodeLookup.values()))
    }
    const wait = last.current + REDRAW_MS - performance.now()
    if (wait <= 0) {
      draw()
      return
    }
    const timer = setTimeout(draw, wait)
    return () => clearTimeout(timer)
  }, [nodes, theme, store])

  const seen = {
    x: -view.x / view.zoom,
    y: -view.y / view.zoom,
    width: view.width / view.zoom,
    height: view.height / view.zoom,
  }
  const map = fit(drawing?.bounds ?? null, seen)
  const at = (r: Rect) => ({
    x: r.x * map.scale + map.x,
    y: r.y * map.scale + map.y,
    width: r.width * map.scale,
    height: r.height * map.scale,
  })
  const frame = at(seen)

  const press = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    press.current = { x: event.clientX, y: event.clientY, view, moved: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = press.current
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.moved && Math.hypot(dx, dy) < CLICK_PX) return
    start.moved = true
    // The frame follows the pointer, so the board moves the other way.
    const { zoom } = start.view
    void flow.setViewport({
      x: start.view.x - (dx / map.scale) * zoom,
      y: start.view.y - (dy / map.scale) * zoom,
      zoom,
    })
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = press.current
    press.current = null
    if (!start || start.moved) return
    const box = event.currentTarget.getBoundingClientRect()
    flow.setCenter(
      (event.clientX - box.left - map.x) / map.scale,
      (event.clientY - box.top - map.y) / map.scale,
      { zoom: view.zoom, duration: reducedMotion() ? 0 : 200 },
    )
  }

  return (
    <Panel
      position="bottom-right"
      className="react-flow__minimap canvas-minimap max-sm:hidden"
      data-testid="minimap"
    >
      <div
        role="img"
        aria-label="Minimap"
        className="relative cursor-pointer overflow-hidden"
        style={{ width: WIDTH, height: HEIGHT, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (press.current = null)}
      >
        <canvas
          ref={canvas}
          className="pointer-events-none absolute top-0 left-0 origin-top-left"
          style={
            drawing
              ? {
                  width: drawing.bounds.width * drawing.scale,
                  height: drawing.bounds.height * drawing.scale,
                  transform: `translate(${at(drawing.bounds).x}px, ${at(drawing.bounds).y}px) scale(${map.scale / drawing.scale})`,
                }
              : { display: 'none' }
          }
        />
        <svg width={WIDTH} height={HEIGHT} className="pointer-events-none absolute inset-0">
          <path
            className="react-flow__minimap-mask"
            // The outer edge sits past the border, so only the frame of the view gets a stroke.
            d={`M-2,-2h${WIDTH + 4}v${HEIGHT + 4}h${-WIDTH - 4}z M${frame.x},${frame.y}h${frame.width}v${frame.height}h${-frame.width}z`}
            fillRule="evenodd"
          />
        </svg>
      </div>
    </Panel>
  )
}
