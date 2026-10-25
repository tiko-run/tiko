import { useEdgesState, useNodesState, type XYPosition } from '@xyflow/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import type { Board } from '@/api/boards'
import { getAuthStatus } from '@/api/auth'
import { AUTH_REQUIRED_EVENT } from '@/api/client'
import { PLANNING_CHANGED_EVENT } from '@/api/planning'
import type { AppEdge, AppNode } from '@/canvas/types'
import { LOCAL, LiveBinding } from '@/live/binding'
import { dragFeed, remoteDrags } from '@/live/drags'
import {
  colorOf,
  parsePeers,
  pacer,
  presenceSender,
  selectedBy,
  setBoardPeers,
  setBoardTravel,
  TRAVEL_MS,
  type PresenceState,
  type PresenceUser,
} from '@/live/presence'

/**
 * connecting: no sync yet; unavailable: none after a while; live: in step with the server;
 * reconnecting: the connection dropped after a sync, edits go on; unsaved: it has been down for
 * a while and this tab holds changes the server has not seen; full: the board has no free place.
 */
export type LiveStatus = 'connecting' | 'unavailable' | 'live' | 'reconnecting' | 'unsaved' | 'full'

// A burst of changes, like typing or a resize, is one undo step.
const UNDO_CAPTURE_MS = 300
const UNAVAILABLE_AFTER_MS = 5000
// A little longer than the transition, so it always finishes.
const GLIDE_MS = 250
const NO_GLIDE: ReadonlySet<string> = new Set()
const NO_SELECTIONS = new Map<string, PresenceUser[]>()
const NO_DRAGS = new Map<string, XYPosition>()
const UNSAVED_AFTER_MS = 30_000
const RECONNECT_AFTER_ACCESS_MS = 1000
const RETRY_FULL_MS = 30_000
const AUTH_PROBE_MS = 5000
const TOO_BIG = 1009
const SESSION_ENDED = 4401
const ACCESS_CHANGED = 4403
const ROOM_FULL = 4429
// Mirrors PLANNING_CHANGED in backend/app/domain/live.py.
const PLANNING_CHANGED = 100
// A guest sends nothing on its own, and the provider drops a socket that is silent for 30 s.
const GUEST_RESYNC_MS = 20_000
const EDITABLE: LiveStatus[] = ['live', 'reconnecting', 'unsaved']

// Until the board is connected there is nobody to tell.
const IDLE = presenceSender(() => {})

function socketUrl(guest: boolean) {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/api/${guest ? 'public' : 'boards'}`
}

/**
 * Board state shared live with everyone on the board.
 *
 * The canvas shows the saved board until the first sync and cannot be edited before it, so no
 * change is ever kept only in a tab the server has not heard from.
 */
export function useLiveBoard(
  board: Board,
  readOnly: boolean,
  onAccessChanged: () => void,
  me: { id: string; name: string } | undefined,
  /**
   * The socket of a public link, for a guest: `<token>/live/<room>`. It carries no presence, and
   * while it is not live the board follows `board`, which the page reloads.
   */
  guest?: string,
) {
  const [nodes, setNodes, onNodesChange] = useNodesState(board.doc.nodes as AppNode[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>(board.doc.edges)
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const binding = useRef<LiveBinding | null>(null)
  const history = useRef<Y.UndoManager | null>(null)
  const synced = useRef(false)
  // What others have selected changes rarely. What they drag goes to the motion through a feed,
  // and their cursors straight to the cursor layer: both change on every frame.
  const [selections, setSelections] = useState(NO_SELECTIONS)
  const [drags] = useState(dragFeed)
  // Nodes someone else just moved or resized: drawn with a short glide.
  const [glide, setGlide] = useState(NO_GLIDE)
  const latest = useRef(nodes)
  const [presence, setPresence] = useState(IDLE)
  const [meId, meName] = [me?.id, me?.name]
  const accessChanged = useRef(onAccessChanged)
  useEffect(() => {
    accessChanged.current = onAccessChanged
  }, [onAccessChanged])

  const reloaded = useRef(board.doc)
  useEffect(() => {
    if (!guest || reloaded.current === board.doc) return
    reloaded.current = board.doc
    // A live socket knows the board better than a reload; one that dropped may never return.
    if (status === 'live') return
    setNodes(board.doc.nodes as AppNode[])
    setEdges(board.doc.edges)
  }, [guest, status, board.doc, setNodes, setEdges])

  useEffect(() => {
    const doc = new Y.Doc()
    let frame = 0
    let gliding: ReturnType<typeof setTimeout> | undefined
    const pull = () => {
      if (!synced.current || frame) return
      // Once per frame: a burst of updates redraws the canvas once.
      frame = requestAnimationFrame(() => {
        frame = 0
        const before = new Map(latest.current.map((node) => [node.id, node]))
        const moved = live.pullNodes(latest.current).filter((node) => {
          const was = before.get(node.id)
          return (
            was !== undefined &&
            was !== node &&
            (was.position.x !== node.position.x ||
              was.position.y !== node.position.y ||
              was.width !== node.width ||
              was.height !== node.height)
          )
        })
        if (moved.length) {
          setGlide(new Set(moved.map((node) => node.id)))
          clearTimeout(gliding)
          gliding = setTimeout(() => setGlide(NO_GLIDE), GLIDE_MS)
        }
        setNodes((current) => live.pullNodes(current))
        setEdges((current) => live.pullEdges(current))
      })
    }
    const live = new LiveBinding(doc, pull)
    live.canWrite = !readOnly
    binding.current = live
    history.current = new Y.UndoManager([live.nodes, live.edges], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: UNDO_CAPTURE_MS,
    })
    // Other tabs of this browser go through the server too, so roles hold for them as well.
    const provider = new WebsocketProvider(
      socketUrl(guest !== undefined),
      guest ?? `${board.id}/live`,
      doc,
      { disableBc: true, resyncInterval: guest ? GUEST_RESYNC_MS : -1 },
    )
    provider.messageHandlers[PLANNING_CHANGED] = () =>
      window.dispatchEvent(new Event(PLANNING_CHANGED_EVENT))
    const awareness = provider.awareness
    // The people on the board never learn that a guest is looking.
    if (guest) awareness.setLocalState(null)
    let mine = IDLE
    if (meId !== undefined) {
      awareness.setLocalState({
        user: { id: meId, name: meName ?? '', color: colorOf(meId) },
        cursor: null,
        selected: [],
        drag: null,
      } satisfies PresenceState)
      mine = presenceSender((patch) => {
        for (const [field, value] of Object.entries(patch)) {
          awareness.setLocalStateField(field, value)
        }
      })
    }
    let shown = { selections: '', drags: '' }
    const pace = pacer()
    const onPresence = (_changes: unknown, origin: unknown) => {
      // This tab's own moves are not frames of the room.
      if (origin !== 'local') setBoardTravel(pace(performance.now()))
      const next = parsePeers(awareness.getStates(), doc.clientID)
      setBoardPeers(next, meId)
      const texts = {
        selections: JSON.stringify(next.map((peer) => [peer.user, peer.selected])),
        drags: JSON.stringify(next.map((peer) => peer.drag)),
      }
      if (texts.selections !== shown.selections) setSelections(selectedBy(next))
      if (texts.drags !== shown.drags) drags.set(remoteDrags(next))
      shown = texts
    }
    awareness.on('change', onPresence)
    const waiting = setTimeout(
      () => setStatus((now) => (now === 'connecting' ? 'unavailable' : now)),
      UNAVAILABLE_AFTER_MS,
    )
    // Changes made while the connection is down live only in this tab until it is back.
    let offlineEdits = false
    let unsaved: ReturnType<typeof setTimeout> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let probed = 0
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin !== provider && !provider.wsconnected) offlineEdits = true
    })
    provider.on('sync', (isSynced: boolean) => {
      if (!isSynced) return
      // On a reconnect the two sides have just exchanged what each was missing.
      offlineEdits = false
      clearTimeout(unsaved)
      setStatus('live')
      // A guest may have been shown a reloaded board in between, so the canvas starts over.
      if (synced.current && !guest) return
      const all = live.reset()
      synced.current = true
      setNodes(all.nodes)
      setEdges(all.edges)
      setPresence(mine)
    })
    provider.on('status', ({ status: link }) => {
      if (link !== 'disconnected' || !synced.current) return
      setStatus((now) => (now === 'live' ? 'reconnecting' : now))
      clearTimeout(unsaved)
      unsaved = setTimeout(() => {
        if (offlineEdits) setStatus((now) => (now === 'reconnecting' ? 'unsaved' : now))
      }, UNSAVED_AFTER_MS)
    })
    provider.on('connection-close', (event) => {
      // A change too big for the server would be sent again on every reconnect.
      if (event?.code === TOO_BIG) window.location.reload()
    })
    provider.on('connection-error', () => {
      // A refused upgrade carries no code; a signed-out tab is told apart by asking.
      if (guest || Date.now() - probed < AUTH_PROBE_MS) return
      probed = Date.now()
      void getAuthStatus()
        .then((auth) => {
          if (!auth.signed_in) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
        })
        .catch(() => {})
    })
    // Codes 4400-4499 are final for the provider: it waits to be told to connect again.
    provider.on('closed', ({ code }) => {
      clearTimeout(retry)
      if (code === SESSION_ENDED) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
      if (code === ACCESS_CHANGED) {
        accessChanged.current()
        // A new role remounts the board with a new connection; the same role comes back here.
        retry = setTimeout(() => provider.connect(), RECONNECT_AFTER_ACCESS_MS)
      }
      if (code === ROOM_FULL) {
        setStatus('full')
        retry = setTimeout(() => provider.connect(), RETRY_FULL_MS)
      }
    })
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (offlineEdits && !provider.wsconnected) event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      clearTimeout(unsaved)
      clearTimeout(retry)
      clearTimeout(waiting)
      clearTimeout(gliding)
      cancelAnimationFrame(frame)
      mine.cancel()
      setPresence(IDLE)
      setBoardPeers([], meId)
      setBoardTravel(TRAVEL_MS)
      setSelections(NO_SELECTIONS)
      drags.set(NO_DRAGS)
      synced.current = false
      binding.current = history.current = null
      provider.destroy()
      doc.destroy()
    }
  }, [board.id, readOnly, setNodes, setEdges, meId, meName, guest, drags])

  // A layout effect: nothing can arrive between a change on the canvas and its write.
  useLayoutEffect(() => {
    latest.current = nodes
    if (synced.current) binding.current?.push(nodes, edges)
  }, [nodes, edges, status])

  const undo = useCallback(() => void history.current?.undo(), [])
  const redo = useCallback(() => void history.current?.redo(), [])
  return {
    nodes,
    setNodes,
    onNodesChange,
    edges,
    setEdges,
    onEdgesChange,
    status,
    /** Whether the person may change the board: synced once and not turned away. */
    editable: EDITABLE.includes(status),
    undo,
    redo,
    selections,
    drags,
    glide,
    presence,
  }
}
