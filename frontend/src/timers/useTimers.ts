import { useEffect, useMemo, useRef, useState } from 'react'
import type { Task } from '@/api/tasks'
import { taskRef } from '@/canvas/tasks-context'
import type { AppNode, TimerData, TimerNode } from '@/canvas/types'
import { chime, primeAudio } from '@/focus/alerts'
import { alertKey, markNotified, notifyTimer, wasNotified } from './alerts'
import { holderLabel } from './attach'
import { useNow } from './clock'
import { formatClock } from './time'
import { checkStatus, describeWatch, goesOffAt, timerState, type TimerState } from './timer'

export type TimerEntry = {
  id: string
  note: string
  state: TimerState
  /** When it goes off next; null while it waits for a status. */
  at: number | null
  holder?: string
  watch?: TimerData['watch']
}
export type FiredTimer = TimerEntry & { at: number }

/** Every timer of the board with its state, soonest first. */
export function listTimers(nodes: AppNode[], now: number): TimerEntry[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return nodes
    .filter((n): n is TimerNode => n.type === 'timer')
    .map((n) => {
      const parent = n.parentId ? byId.get(n.parentId) : undefined
      return {
        id: n.id,
        note: n.data.note,
        state: timerState(n.data, now),
        at: goesOffAt(n.data),
        holder: parent && holderLabel(parent),
        watch: n.data.watch,
      }
    })
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))
}

type Options = {
  tasks: Record<string, Task>
  onOpen: (id: string) => void
  onChange: (id: string, change: (data: TimerData) => TimerData) => void
}

/**
 * Timers that went off on this board: alerts each once, with a chime and a browser
 * notification while the board is open, quietly for those that went off while it was closed.
 * Status timers go off when the board's refresh shows their task in another status.
 */
export function useTimers(nodes: AppNode[], { tasks, onOpen, onChange }: Options) {
  const now = useNow()
  const [openedAt] = useState(() => Date.now())
  const [missed, setMissed] = useState(0)
  const onOpenRef = useRef(onOpen)

  const timers = useMemo(() => listTimers(nodes, now), [nodes, now])
  const fired = useMemo(() => timers.filter((t): t is FiredTimer => t.state === 'fired'), [timers])
  const firedKey = fired.map((t) => alertKey(t.id, t.at)).join()
  const firedRef = useRef(fired)

  useEffect(() => {
    onOpenRef.current = onOpen
    firedRef.current = fired
  })

  useEffect(() => {
    const fresh = firedRef.current.filter((t) => !wasNotified(alertKey(t.id, t.at)))
    if (fresh.length === 0) return
    markNotified(fresh.map((t) => alertKey(t.id, t.at)))
    const late = fresh.filter((t) => t.at < openedAt)
    if (late.length > 0) setMissed((count) => count + late.length)
    const live = fresh.filter((t) => t.at >= openedAt)
    if (live.length > 0) chime()
    for (const t of live) {
      const body = [
        t.holder && `On ${t.holder}`,
        t.watch ? describeWatch(t.watch) : `Set for ${formatClock(t.at)}`,
      ]
      notifyTimer(t.id, t.note || 'Reminder', body.filter(Boolean).join(' · '), () =>
        onOpenRef.current(t.id),
      )
    }
    // firedKey changes exactly when the set of timers that went off changes; openedAt never does.
  }, [firedKey, openedAt])

  useEffect(() => {
    for (const node of nodes) {
      if (node.type !== 'timer' || !node.data.watch) continue
      const task = tasks[taskRef(node.data.watch)]
      if (checkStatus(node.data, task, Date.now())) {
        onChange(node.id, (data) => checkStatus(data, task, Date.now()) ?? data)
      }
    }
  }, [nodes, tasks, onChange])

  useEffect(() => {
    const base = document.title
    if (fired.length > 0) document.title = `(${fired.length}) ${base}`
    return () => {
      document.title = base
    }
  }, [fired.length])

  // The chime needs a page gesture first; any click on the page counts.
  useEffect(() => {
    window.addEventListener('pointerdown', primeAudio, { once: true })
    return () => window.removeEventListener('pointerdown', primeAudio)
  }, [])

  return { timers, fired, missed, dismissMissed: () => setMissed(0) }
}
