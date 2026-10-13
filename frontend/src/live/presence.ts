import { useSyncExternalStore } from 'react'
import { z } from 'zod'

/** Colors a person can get; `--presence-0` … `--presence-7` in index.css. */
export const PRESENCE_COLORS = 8
const MAX_SELECTED = 200
/** Past this many nodes a drag is not shown live; the others see the result on the drop. */
export const MAX_LIVE_DRAG = 200
export const CURSOR_INTERVAL_MS = 50
/** How long a pointer or a dragged node takes to its next place: a little over the gap between
 *  two presence frames, so it is still moving when the next one comes. */
export const TRAVEL_MS = 80
/** The same in a busy room, which sends presence half as often. */
export const TRAVEL_BUSY_MS = 160
// Frames further apart than this tell of people who paused, not of the room's pace.
const PAUSE_MS = 250
const BUSY_GAP_MS = 75

const xy = z.object({ x: z.number(), y: z.number() })
const stateSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string().max(200),
    color: z
      .number()
      .int()
      .min(0)
      .max(PRESENCE_COLORS - 1),
  }),
  cursor: xy.nullable().catch(null),
  selected: z.array(z.string()).max(MAX_SELECTED).catch([]),
  drag: z.record(z.string(), xy).nullable().catch(null),
})

export type PresenceUser = z.infer<typeof stateSchema>['user']
export type PresenceState = z.infer<typeof stateSchema>
/** Another tab on the board; `client` is its Yjs client id. */
export type Peer = PresenceState & { client: number }

/** The person's color: the same on every screen, because it comes from their id. */
export function colorOf(userId: string): number {
  let hash = 2166136261
  for (let i = 0; i < userId.length; i++) {
    hash = Math.imul(hash ^ userId.charCodeAt(i), 16777619)
  }
  return (hash >>> 0) % PRESENCE_COLORS
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters =
    words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.trim().slice(0, 2)
  return letters.toUpperCase() || '?'
}

/** Every other tab with a readable state; anything a client sent in another shape is skipped. */
export function parsePeers(states: Map<number, unknown>, self: number): Peer[] {
  const peers: Peer[] = []
  for (const [client, raw] of states) {
    if (client === self) continue
    const parsed = stateSchema.safeParse(raw)
    if (parsed.success) peers.push({ ...parsed.data, client })
  }
  return peers.sort((a, b) => a.client - b.client)
}

/** People on the board besides this one: one entry per person, however many tabs they have. */
export function peopleOf(peers: Peer[], me: string | undefined): PresenceUser[] {
  const seen = new Map<string, PresenceUser>()
  for (const peer of peers) {
    if (peer.user.id !== me && !seen.has(peer.user.id)) seen.set(peer.user.id, peer.user)
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function selection(ids: string[]): string[] {
  return ids.slice(0, MAX_SELECTED)
}

/** Runs at once, then at most once per interval with the latest arguments. */
export function throttle<A extends unknown[]>(run: (...args: A) => void, intervalMs: number) {
  let last = -Infinity
  let pending: A | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = (args: A) => {
    last = Date.now()
    pending = null
    run(...args)
  }
  const throttled = (...args: A) => {
    const wait = last + intervalMs - Date.now()
    if (wait <= 0) return fire(args)
    pending = args
    timer ??= setTimeout(() => {
      timer = undefined
      if (pending) fire(pending)
    }, wait)
  }
  throttled.cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = null
  }
  return throttled
}

/**
 * Tells how long a move should take from the moments presence frames arrive. The web app is not
 * told the room's pace: it measures it, so it follows whatever the server sends.
 */
export function pacer() {
  let last = -Infinity
  let gap = CURSOR_INTERVAL_MS
  return (now: number) => {
    const passed = now - last
    last = now
    if (passed < PAUSE_MS) gap += (passed - gap) * 0.2
    return gap > BUSY_GAP_MS ? TRAVEL_BUSY_MS : TRAVEL_MS
  }
}

/**
 * What a tab tells the others. The cursor and the nodes it drags travel in one message, at most
 * every 50 ms, so on the other screens a dragged node keeps its place under the cursor.
 */
export function presenceSender(send: (patch: Partial<PresenceState>) => void) {
  let patch: Partial<PresenceState> = {}
  const flush = throttle(() => {
    const next = patch
    patch = {}
    send(next)
  }, CURSOR_INTERVAL_MS)
  return {
    cursor: (cursor: PresenceState['cursor']) => {
      patch.cursor = cursor
      flush()
    },
    drag: (drag: PresenceState['drag']) => {
      patch.drag = drag
      flush()
    },
    selected: (ids: string[]) => send({ selected: selection(ids) }),
    cancel: () => {
      flush.cancel()
      patch = {}
    },
  }
}

/** Who has each node selected: one entry per person, however many tabs they have. */
export function selectedBy(peers: Peer[]): Map<string, PresenceUser[]> {
  const byNode = new Map<string, PresenceUser[]>()
  for (const peer of peers) {
    for (const id of peer.selected) {
      const users = byNode.get(id) ?? []
      if (!users.some((user) => user.id === peer.user.id)) users.push(peer.user)
      byNode.set(id, users)
    }
  }
  return byNode
}

// The canvas publishes who is on the open board. The top bar, in another tree, shows the people;
// the cursor layer reads the tabs itself, so a moving cursor redraws only that layer and not
// the whole canvas.
let people: PresenceUser[] = []
let tabs: Peer[] = []
let travel = TRAVEL_MS
const listeners = new Set<() => void>()
const NOBODY: PresenceUser[] = []
const NO_TABS: Peer[] = []

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setBoardPeers(next: Peer[], me: string | undefined) {
  tabs = next
  const nextPeople = peopleOf(next, me)
  if (JSON.stringify(nextPeople) !== JSON.stringify(people)) people = nextPeople
  for (const listener of listeners) listener()
}

export function setBoardTravel(ms: number) {
  if (ms === travel) return
  travel = ms
  for (const listener of listeners) listener()
}

export function useBoardPeople() {
  return useSyncExternalStore(
    subscribe,
    () => people,
    () => NOBODY,
  )
}

export function useBoardPeers() {
  return useSyncExternalStore(
    subscribe,
    () => tabs,
    () => NO_TABS,
  )
}

/** How long other people's pointers and drags take between two frames on the open board. */
export function useBoardTravel() {
  return useSyncExternalStore(
    subscribe,
    () => travel,
    () => TRAVEL_MS,
  )
}
