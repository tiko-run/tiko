import type { XYPosition } from '@xyflow/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AppNode } from '@/canvas/types'
import { TRAVEL_MS } from '@/live/presence'

/**
 * How other people's moves are drawn.
 *
 * The positions handed to the canvas are animated, not the elements on screen. Arrows, what a
 * frame holds, attached timers, outlines and anything else that is placed from a node's position
 * are worked out from the same numbers on every frame, so nothing can trail behind the node it
 * belongs to. A new kind of element needs nothing here as long as it is placed from its node.
 */
type Box = { x: number; y: number; width?: number; height?: number }
type Tween = { from: Box; to: Box; start: number; ms: number; linear: boolean }
export type Motion = ReadonlyMap<string, Tween>

// A dragged node gets a new place with every presence frame and moves evenly between them, in
// the time the caller measured; a change that arrives whole glides in and slows down at the end.
const GLIDE_MS = 150
const STILL: Motion = new Map()

const boxOf = (node: AppNode): Box => ({
  x: node.position.x,
  y: node.position.y,
  width: node.width,
  height: node.height,
})
const same = (a: Box, b: Box) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

function between(from: number | undefined, to: number | undefined, t: number) {
  return from === undefined || to === undefined ? to : from + (to - from) * t
}

/** Where a moving node is at a moment. */
export function at(tween: Tween, now: number): Box {
  const passed = tween.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - tween.start) / tween.ms))
  const t = tween.linear ? passed : 1 - (1 - passed) ** 3
  return {
    x: between(tween.from.x, tween.to.x, t)!,
    y: between(tween.from.y, tween.to.y, t)!,
    width: between(tween.from.width, tween.to.width, t),
    height: between(tween.from.height, tween.to.height, t),
  }
}

/** Where each node should end up: where someone is dragging it, or its own place. */
function target(
  node: AppNode,
  drags: ReadonlyMap<string, XYPosition>,
  originOf: (parentId: string) => XYPosition | undefined,
): Box {
  const dragged = node.dragging ? undefined : drags.get(node.id)
  if (!dragged) return boxOf(node)
  const origin = (node.parentId && originOf(node.parentId)) || { x: 0, y: 0 }
  return { ...boxOf(node), x: dragged.x - origin.x, y: dragged.y - origin.y }
}

/**
 * The moves in progress after the nodes, the remote drags or the just-arrived changes changed.
 * Only what someone else did is animated: the person's own changes show at once.
 */
export function plan(
  nodes: AppNode[],
  drags: ReadonlyMap<string, XYPosition>,
  arrived: ReadonlySet<string>,
  motion: Motion,
  previous: ReadonlyMap<string, Box>,
  now: number,
  originOf: (parentId: string) => XYPosition | undefined,
  instant = false,
  dragMs = TRAVEL_MS,
): Motion {
  const next = new Map<string, Tween>()
  let changed = false
  for (const node of nodes) {
    const current = motion.get(node.id)
    const dragged = !node.dragging && drags.has(node.id)
    const remote = dragged || arrived.has(node.id)
    if (!remote && !current) continue
    if (node.dragging) {
      changed ||= current !== undefined
      continue
    }
    const to = target(node, drags, originOf)
    if (current && same(current.to, to)) {
      // A finished glide is over; a dragged node stays held where the drag has it.
      if (!dragged && now >= current.start + current.ms) changed = true
      else next.set(node.id, current)
      continue
    }
    const from = current ? at(current, now) : previous.get(node.id)
    if (!remote || !from || same(from, to)) {
      changed ||= current !== undefined
      continue
    }
    const ms = instant ? 0 : dragged ? dragMs : GLIDE_MS
    next.set(node.id, { from, to, start: now, ms, linear: dragged })
    changed = true
  }
  if (!changed && next.size === motion.size) return motion
  return next.size ? next : STILL
}

/** The nodes as they are drawn at a moment; the same array when nothing moves. */
export function show(nodes: AppNode[], motion: Motion, now: number): AppNode[] {
  if (motion.size === 0) return nodes
  return nodes.map((node) => {
    const tween = motion.get(node.id)
    if (!tween) return node
    const { x, y, width, height } = at(tween, now)
    return { ...node, position: { x, y }, width, height } as AppNode
  })
}

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/** The canvas nodes with other people's moves in progress applied, frame by frame. */
export function useRemoteMotion(
  nodes: AppNode[],
  drags: ReadonlyMap<string, XYPosition>,
  arrived: ReadonlySet<string>,
  originOf: (parentId: string) => XYPosition | undefined,
  dragMs = TRAVEL_MS,
): AppNode[] {
  const [motion, setMotion] = useState<Motion>(STILL)
  const [now, setNow] = useState(0)
  // Where every node was last meant to be: where a glide starts from.
  const previous = useRef<Map<string, Box>>(new Map())

  // Before the browser paints, so a node never shows at its new place and then jumps back.
  useLayoutEffect(() => {
    const moment = performance.now()
    const next = plan(
      nodes,
      drags,
      arrived,
      motion,
      previous.current,
      moment,
      originOf,
      reducedMotion(),
      dragMs,
    )
    previous.current = new Map(nodes.map((node) => [node.id, target(node, drags, originOf)]))
    if (next !== motion) {
      setMotion(next)
      setNow(moment)
    }
  }, [nodes, drags, arrived, motion, originOf, dragMs])

  useEffect(() => {
    if (motion.size === 0) return
    let frame = requestAnimationFrame(function step(moment) {
      const running = [...motion.values()].some((tween) => moment < tween.start + tween.ms + 20)
      if (running) setNow(moment)
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [motion])

  return useMemo(() => show(nodes, motion, now), [nodes, motion, now])
}
