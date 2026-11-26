import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { dropTarget, INDENT, type DropTarget } from '@/modules/gantt/drag'
import type { DragStore, Layout } from '@/modules/gantt/drag-store'
import type { Row } from '@/modules/gantt/rows'
import { MAX_DEPTH, movingDepth, movingRows, type TreeRow } from '@/modules/gantt/tree'
import { useZoom } from '@/modules/expanded'

// A press that moves further than this starts a drag.
const DRAG_SLOP = 4
// Near an edge the list scrolls or the board pans, faster closer to it.
export const EDGE = 40
const MIN_STEP = 2
const MAX_STEP = 16
const SETTLE_MS = 150

type Point = { x: number; y: number }

type Drag = {
  /** A drag moves rows; a lasso selects them. */
  mode: 'drag' | 'lasso'
  ids: string[]
  pointerId: number
  press: Point
  /** The press in module pixels: x from the rows' left, y from the pressed row's top. */
  grab: Point
  /** Where the pressed row sits in the ghost, in rows. */
  ghostIndex: number
  startDepth: number
  last: Point
  target: DropTarget | null
  outside: boolean
  dragging: boolean
  /** The visible rows the layout was drawn for, so a change by someone else redraws it. */
  rowsKey: string
  /** Lasso: the press below the rows' top, and what stays selected besides what it covers. */
  startY: number
  base: Set<string>
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** How far the pointer is into an edge zone, as a step in pixels; negative toward the start. */
export function edgeStep(at: number, start: number, end: number) {
  const ramp = (depth: number) =>
    Math.round(MIN_STEP + (MAX_STEP - MIN_STEP) * Math.min(Math.max(depth / EDGE, 0), 1))
  if (at < start + EDGE) return -ramp(start + EDGE - at)
  if (at > end - EDGE) return ramp(at - (end - EDGE))
  return 0
}

/**
 * Drags rows in the task column: the rows that stay move aside, a gap shows where and at which
 * level the dragged rows land, the list scrolls or the board pans at an edge, Esc cancels. A press
 * on blank space draws a lasso that selects the rows it touches.
 */
export function useRowDrag({
  store,
  rowsEl,
  ghostEl,
  rows,
  visible,
  rowHeight,
  expanded,
  edgeTop,
  onDrop,
  onEject,
  onClick,
  onSelect,
}: {
  store: DragStore
  rowsEl: React.RefObject<HTMLDivElement | null>
  ghostEl: React.RefObject<HTMLDivElement | null>
  rows: Row[]
  visible: TreeRow[]
  rowHeight: number
  expanded: boolean
  /** Expanded: the height of the headers that stay over the scrolling rows. */
  edgeTop: number
  onDrop: (ids: string[], aboveId: string | null, depth: number) => void
  onEject: (ids: string[], screen: Point) => void
  /** A press that never became a drag. */
  onClick?: (id: string, event: PointerEvent) => void
  /** What a lasso selected; the selection before it for a click on blank space. */
  onSelect?: (ids: Set<string>) => void
}) {
  const getZoom = useZoom()
  const flow = useReactFlow()
  const drag = useRef<Drag | null>(null)
  // Removes the window listeners of the drag in progress.
  const unlisten = useRef<(() => void) | null>(null)
  // A drop gliding into place, or rows gliding back after a cancel; ended when the Gantt goes.
  const settle = useRef<{ animation?: Animation; timer?: ReturnType<typeof setTimeout> }>({})
  const alive = useRef(true)
  const props = { rows, visible, rowHeight, expanded, edgeTop, onDrop, onEject, onClick, onSelect }
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  const moduleBox = () => {
    const el = rowsEl.current
    const box = el?.closest('[data-module-expanded]') ?? el?.closest('.react-flow__node')
    return box?.getBoundingClientRect()
  }

  // The pointer in module pixels from the rows' top left.
  const local = (point: Point): Point => {
    const box = rowsEl.current?.getBoundingClientRect()
    const zoom = getZoom()
    return { x: (point.x - (box?.left ?? 0)) / zoom, y: (point.y - (box?.top ?? 0)) / zoom }
  }

  const layoutOf = (moving: Set<string>, target: DropTarget | null, animate: boolean): Layout => {
    const { visible, rowHeight: h } = latest.current
    const lifted = visible.filter((t) => moving.has(t.row.id))
    const gap = target ? lifted.length * h : 0
    const shift = new Map<string, number>()
    let r = 0
    visible.forEach((t, i) => {
      if (moving.has(t.row.id)) return
      const y = r * h + (target && r >= target.slot ? gap : 0)
      shift.set(t.row.id, y - i * h)
      r++
    })
    return {
      shift,
      hidden: new Set(lifted.map((t) => t.row.id)),
      parentId: target?.fits ? target.parentId : null,
      animate: animate && !reducedMotion(),
      placeholder: target && {
        top: target.slot * h,
        height: Math.max(gap, h),
        depth: target.depth,
        fits: target.fits,
      },
    }
  }

  const update = (point: Point) => {
    const d = drag.current
    if (!d?.dragging) return
    d.last = point
    const { rows, visible, rowHeight: h, expanded } = latest.current
    const { tops, moving } = movingRows(rows, d.ids)
    const box = moduleBox()
    const inside =
      !box ||
      (point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom)
    const at = local(point)
    const top = at.y - d.grab.y - d.ghostIndex * h
    const dx = at.x - d.grab.x
    const place = () =>
      ghostEl.current?.style.setProperty('transform', `translate(${dx}px, ${top}px)`)
    place()
    const lifted = visible.filter((t) => moving.has(t.row.id))
    const target = inside
      ? dropTarget({
          rest: visible.filter((t) => !moving.has(t.row.id)),
          ghostTop: top,
          rowHeight: h,
          dx,
          startDepth: d.startDepth,
          deepest: movingDepth(rows, tops),
        })
      : null
    const outside = !inside && !expanded
    const rowsKey = visible.map((t) => t.row.id).join(' ')
    const same =
      d.rowsKey === rowsKey &&
      d.target?.slot === target?.slot &&
      d.target?.depth === target?.depth &&
      d.target?.fits === target?.fits &&
      d.target?.aboveId === target?.aboveId &&
      d.outside === outside &&
      store.layout?.hidden.size === lifted.length
    d.target = target
    d.outside = outside
    d.rowsKey = rowsKey
    if (same && store.ghost) return
    store.set(layoutOf(moving, target, true), {
      rows: lifted,
      startDepth: d.startDepth,
      outside,
      // Rows under a picked parent go too, folded ones included.
      count: moving.size,
    })
    // The ghost appears with the first layout: place it as soon as it is there.
    place()
  }

  const updateLasso = (point: Point) => {
    const d = drag.current
    if (!d?.dragging) return
    d.last = point
    const { visible, rowHeight: h } = latest.current
    const y = local(point).y
    const top = Math.min(d.startY, y)
    const bottom = Math.max(d.startY, y)
    const hit = new Set(d.base)
    visible.forEach((t, i) => {
      if (i * h < bottom && (i + 1) * h > top) hit.add(t.row.id)
    })
    store.setLasso(hit, { top, height: bottom - top })
  }

  const refresh = (point: Point) => (drag.current?.mode === 'lasso' ? updateLasso : update)(point)

  const finish = () => {
    drag.current = null
    unlisten.current?.()
    unlisten.current = null
  }

  const cancel = () => {
    const d = drag.current
    if (!d) return
    finish()
    if (d.mode === 'lasso') return store.setLasso(null, null)
    if (!d.dragging) return
    store.set(layoutOf(new Set(), null, true), null)
    clearTimeout(settle.current.timer)
    settle.current.timer = setTimeout(() => {
      if (!drag.current) store.set(null, null)
    }, SETTLE_MS)
  }

  // The drop place against the plan as it is now: its row in view and its level still allowed.
  const stillFits = (ids: string[], target: DropTarget) => {
    const { rows, visible } = latest.current
    const { tops, moving } = movingRows(rows, ids)
    if (tops.length === 0) return false
    const rest = visible.filter((t) => !moving.has(t.row.id))
    const slot =
      target.aboveId === null ? 0 : rest.findIndex((t) => t.row.id === target.aboveId) + 1
    if (slot === 0 && target.aboveId !== null) return false
    const above = rest[slot - 1]
    const below = rest[slot]
    const min = below ? below.depth : 0
    const max = Math.min(above ? above.depth + 1 : 0, MAX_DEPTH - 1 - movingDepth(rows, tops))
    return target.depth >= min && target.depth <= max
  }

  // Where the pressed row sits among the lifted rows, which change when someone else edits.
  const placeInGhost = (d: Drag) => {
    const { rows, visible } = latest.current
    const { moving } = movingRows(rows, d.ids)
    const lifted = visible.filter((t) => moving.has(t.row.id))
    return lifted.findIndex((t) => t.row.id === d.ids[0])
  }

  const begin = (d: Drag) => {
    const { rows, visible } = latest.current
    const { tops, moving } = movingRows(rows, d.ids)
    const lifted = visible.filter((t) => moving.has(t.row.id))
    const pressed = visible.findIndex((t) => t.row.id === d.ids[0])
    const index = lifted.findIndex((t) => t.row.id === visible[pressed]?.row.id)
    d.ghostIndex = Math.max(index, 0)
    d.startDepth = visible.find((t) => t.row.id === tops[0])?.depth ?? 0
    d.dragging = true
  }

  const press = (event: ReactPointerEvent, id: string, ids: string[]) => {
    if (event.button !== 0 || drag.current || settle.current.animation) return
    const point = { x: event.clientX, y: event.clientY }
    const pressed = latest.current.visible.findIndex((t) => t.row.id === id)
    if (pressed < 0) return
    const grab = local(point)
    drag.current = {
      mode: 'drag',
      startY: 0,
      base: new Set(),
      rowsKey: '',
      // The pressed row first, so the ghost knows which of its rows the pointer holds.
      ids: [id, ...ids.filter((other) => other !== id)],
      pointerId: event.pointerId,
      press: point,
      grab: { x: grab.x, y: grab.y - pressed * latest.current.rowHeight },
      ghostIndex: 0,
      startDepth: 0,
      last: point,
      target: null,
      outside: false,
      dragging: false,
    }
    // Bound by hand rather than through state, so a press does not render the whole Gantt again.
    unlisten.current = listen()
  }

  /** `id`: the row whose blank space was pressed; a click there picks that row. */
  const lasso = (event: ReactPointerEvent, base: Set<string>, id?: string) => {
    if (event.button !== 0 || drag.current) return
    // The board must not start its own selection box or pan from here.
    event.stopPropagation()
    const point = { x: event.clientX, y: event.clientY }
    drag.current = {
      mode: 'lasso',
      ids: id ? [id] : [],
      pointerId: event.pointerId,
      press: point,
      grab: { x: 0, y: 0 },
      ghostIndex: 0,
      startDepth: 0,
      last: point,
      target: null,
      outside: false,
      dragging: false,
      rowsKey: '',
      startY: local(point).y,
      base,
    }
    unlisten.current = listen()
  }

  const listen = () => {
    const move = (event: PointerEvent) => {
      const d = drag.current
      if (!d || event.pointerId !== d.pointerId) return
      const point = { x: event.clientX, y: event.clientY }
      if (!d.dragging) {
        if (Math.hypot(point.x - d.press.x, point.y - d.press.y) < DRAG_SLOP) return
        if (d.mode === 'lasso') d.dragging = true
        else begin(d)
      }
      refresh(point)
    }
    // A row someone else folded away or removed while it was pressed is not picked.
    const click = (id: string, event: PointerEvent) => {
      if (latest.current.visible.some((t) => t.row.id === id)) latest.current.onClick?.(id, event)
    }
    const up = (event: PointerEvent) => {
      const d = drag.current
      if (!d || event.pointerId !== d.pointerId) return
      if (d.mode === 'lasso') {
        if (d.dragging) updateLasso({ x: event.clientX, y: event.clientY })
        const picked = d.dragging ? (store.lasso ?? new Set<string>()) : d.base
        finish()
        store.setLasso(null, null)
        if (!d.dragging && d.ids[0]) click(d.ids[0], event)
        else latest.current.onSelect?.(picked)
        return
      }
      if (!d.dragging) {
        finish()
        click(d.ids[0], event)
        return
      }
      update({ x: event.clientX, y: event.clientY })
      const { target, outside } = d
      const { rows, onEject } = latest.current
      if (outside) {
        finish()
        store.set(null, null)
        const ids = new Set(d.ids)
        const ordered = rows.filter((r) => ids.has(r.id)).map((r) => r.id)
        return onEject(ordered, { x: event.clientX, y: event.clientY })
      }
      if (!target?.fits) return cancel()
      finish()
      // Read at landing, not at release: the plan may have changed while the ghost glided.
      const land = () => {
        settle.current.animation = undefined
        if (!alive.current) return
        store.set(null, null)
        // Someone may have folded or removed the place while the ghost glided: then the rows
        // stay where they were rather than land out of sight.
        if (!stillFits(d.ids, target)) return
        latest.current.onDrop(d.ids, target.aboveId, target.depth)
      }
      // The ghost glides into the gap first, so the rows land where it was without a jump.
      const ghost = ghostEl.current
      if (!ghost || typeof ghost.animate !== 'function' || reducedMotion()) return land()
      const y = target.slot * latest.current.rowHeight
      const x = (target.depth - d.startDepth) * INDENT
      const animation = ghost.animate(
        [{ transform: ghost.style.transform }, { transform: `translate(${x}px, ${y}px)` }],
        { duration: SETTLE_MS, easing: 'ease-out', fill: 'forwards' },
      )
      settle.current.animation = animation
      animation.finished.then(land, land)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Before the expanded view and the board see it: Esc ends the drag, nothing else.
      event.preventDefault()
      event.stopPropagation()
      cancel()
    }
    const lost = (event: PointerEvent) => {
      if (event.pointerId === drag.current?.pointerId) cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', lost)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    // Near an edge the expanded list scrolls, or the board pans, and the gap follows.
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const d = drag.current
      if (!d?.dragging) return
      if (latest.current.expanded) {
        const scroller = rowsEl.current?.closest<HTMLElement>('[data-expanded-scroll]')
        if (!scroller) return
        const box = scroller.getBoundingClientRect()
        const step = edgeStep(d.last.y, box.top + latest.current.edgeTop, box.bottom)
        if (!step) return
        const before = scroller.scrollTop
        scroller.scrollTop = before + step
        if (scroller.scrollTop !== before) refresh(d.last)
      } else {
        const step = edgeStep(d.last.y, 0, window.innerHeight)
        if (!step) return
        const view = flow.getViewport()
        flow.setViewport({ ...view, y: view.y - step })
        refresh(d.last)
      }
    }
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', lost)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cancel)
      cancelAnimationFrame(frame)
    }
  }

  useEffect(() => {
    alive.current = true
    const pending = settle.current
    return () => {
      alive.current = false
      unlisten.current?.()
      pending.animation?.cancel()
      clearTimeout(pending.timer)
    }
  }, [])

  // The Gantt renders mid-drag only when someone else changed the plan: the gap follows, and
  // rows they removed leave the drag.
  useEffect(() => {
    const d = drag.current
    if (!d?.dragging) return
    const ids = new Set(latest.current.rows.map((r) => r.id))
    const pressed = d.ids[0]
    d.ids = d.ids.filter((id) => ids.has(id))
    if (d.mode === 'drag') {
      // The row under the pointer is gone, or out of view: the drag has nothing to hold.
      if (d.ids[0] !== pressed) return cancel()
      const index = placeInGhost(d)
      if (index < 0) return cancel()
      d.ghostIndex = index
    }
    refresh(d.last)
  })

  return { press, lasso, busy: () => drag.current !== null }
}
