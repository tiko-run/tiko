import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionMode,
  ControlButton,
  Controls,
  Panel,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore,
  type Connection,
  type OnConnectEnd,
  type XYPosition,
  type OnBeforeDelete,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Map as MapIcon } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { canEdit, getBoard, type Board } from '@/api/boards'
import type { Task } from '@/api/tasks'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { anchorAt, orphanAnchors, raiseAnchors } from '@/canvas/anchors'
import { CanvasContextMenu, type MenuTarget, type PlaceTool } from '@/canvas/CanvasContextMenu'
import {
  cloneSnippet,
  copySelection,
  clipboardId,
  getClipboard,
  setClipboard,
  snippetOrigin,
  type Snippet,
} from '@/canvas/clipboard'
import { markFresh } from '@/canvas/editing'
import { framesFirst, releaseChildren, reparent, splitDeletion } from '@/canvas/frames'
import { Guides } from '@/canvas/Guides'
import { CARD_GUESS, columnPositions } from '@/canvas/layout'
import {
  alignShifts,
  applyShifts,
  boxesOf,
  distributeShifts,
  movers,
  type Alignment,
  type Distribution,
} from '@/canvas/align'
import { absorbCards } from '@/canvas/modules'
import { useTouchSelect } from '@/canvas/touch-select'
import { useShiftWheelPan, useWheel } from '@/canvas/wheel'
import { moduleControls } from '@/canvas/module-controls'
import { ModuleExpanded } from '@/canvas/ModuleExpanded'
import { AnchorNode } from '@/canvas/nodes/AnchorNode'
import { FrameNode } from '@/canvas/nodes/FrameNode'
import { TaskCardNode } from '@/canvas/nodes/TaskCardNode'
import { ModuleNode } from '@/canvas/nodes/ModuleNode'
import { StickyNode } from '@/canvas/nodes/StickyNode'
import { TextNode } from '@/canvas/nodes/TextNode'
import { hasMixedSources } from '@/canvas/node-tasks'
import { indexTasks, taskRef, TasksContext } from '@/canvas/tasks-context'
import { BoardSourcesContext } from '@/sources/board-sources'
import { Toolbar, type Tool } from '@/canvas/Toolbar'
import { RefreshIndicator } from '@/board/RefreshIndicator'
import { lastFetched, lastSynced, newest } from '@/board/refresh-timing'
import { useRefresh, type Guest } from '@/board/useRefresh'
import { useDrawRect, type ScreenRect } from '@/canvas/useDrawRect'
import { useGuides } from '@/canvas/useGuides'
import { useRemoteMotion } from '@/live/motion'
import { withHandles } from '@/canvas/handles'
import {
  FarCard,
  FarFrame,
  FarModule,
  FarShape,
  FarSticky,
  FarText,
  farView,
} from '@/canvas/nodes/far'
import { MAX_LIVE_DRAG, useBoardTravel } from '@/live/presence'
import { SelectedByContext, withPresence } from '@/live/PresenceRing'
import { PresenceLayer } from '@/live/PresenceLayer'
import { getAuthStatus } from '@/api/auth'
import { PLANNING_CHANGED_EVENT, PLANNING_KEY, usePlanningQuery } from '@/api/planning'
import { useLiveBoard, type LiveStatus } from '@/live/useLiveBoard'
import { toast } from 'sonner'
import { ERROR_MS } from '@/lib/toast'
import { readViewport, saveViewport } from '@/live/viewport'
import type {
  AppEdge,
  AppNode,
  ModuleNode as ModuleNodeType,
  TaskCardNode as TaskCardNodeType,
  TimerData,
} from '@/canvas/types'
import { newId } from '@/lib/id'
import { STICKY_MAX_CHARS } from '@/canvas/fit'
import { SHAPE_MIN, SHAPE_SIZE, type ShapeKind } from '@/canvas/shapes'
import { ShapeNode } from '@/canvas/nodes/ShapeNode'
import { ShapeGhost } from '@/canvas/ShapeGhost'
import { Minimap, readMinimapShown, saveMinimapShown } from '@/canvas/Minimap'
import { FarContext, ReadOnlyContext } from '@/canvas/readonly'
import { CLIPBOARD_MARKER, classifyPaste, isEditable, readPasteAs } from '@/canvas/paste'
import { MAX_REFS, resolveAll } from '@/canvas/refs'
import { SelectionBar } from '@/canvas/SelectionBar'
import { barNodes, withStyle, type Kind, type Style } from '@/canvas/selection-props'
import { ExpandModuleContext } from '@/modules/expanded'
import { ModuleHostContext } from '@/modules/host-context'
import { PlanningContext } from '@/planning/context'
import { findModule } from '@/modules/registry'
import type { ModuleHost } from '@/modules/types'
import { dialogOverBoard, useShortcut } from '@/lib/shortcuts'
import { askNotify, primeAudio } from '@/focus/alerts'
import { BESIDE, dropTimers, holdsTimers, TIMER_SIZE } from '@/timers/attach'
import { toolCursor } from '@/canvas/cursors'
import {
  flyTo,
  forgetViews,
  reducedMotion,
  rememberView,
  takeView,
  useCanGoBack,
  useFlashingId,
} from '@/canvas/fly'
import { BoardSearch } from '@/search/BoardSearch'
import { useSearchHits } from '@/search/palette'
import { BoardTimers } from '@/timers/BoardTimers'
import { newTimer, waitsForStatus } from '@/timers/timer'
import { TimerNode } from '@/timers/TimerNode'
import { useTheme } from '@/lib/theme'
import { didOnboarding } from '@/onboarding/done'
import { topOverlay } from '@/lib/overlays'

const nodeTypes = {
  task_card: withPresence(farView(TaskCardNode, FarCard)),
  frame: withPresence(farView(FrameNode, FarFrame)),
  sticky: withPresence(farView(StickyNode, FarSticky)),
  shape: withPresence(farView(ShapeNode, FarShape)),
  text: withPresence(farView(TextNode, FarText)),
  module: withPresence(farView(ModuleNode, FarModule)),
  anchor: AnchorNode,
  timer: withPresence(TimerNode),
}
const defaultEdgeOptions = { markerEnd: { type: MarkerType.ArrowClosed } }

// New cards step down by about one card height so several adds in a row stay readable.
const CASCADE_X = 16
const CASCADE_Y = 96
// Under the 300 ms undo capture, so the close-up joins the add in one undo step.
const CLOSE_UP_MS = 250
// Duplicates land next to the original; a drag shorter than this places a default-size frame.
const DUPLICATE_OFFSET = 24
const MIN_DRAW = 8
// A shape may be dragged out along one axis; the other one then takes the smallest size.
const drawn = ({ width, height }: { width: number; height: number }) =>
  width >= MIN_DRAW || height >= MIN_DRAW
// Same floor as the frame resizer, so a thin drag still makes a usable frame.
const MIN_FRAME = { width: 160, height: 120 }
// An arrow released closer than this to where it started was a click on the handle, not a drag.
const MIN_ARROW = 16

// Leaves room for the top bar, the focus capsule and the toolbar over the board.
// At 20% and below text is under 3 screen pixels: elements are drawn as blocks.
const FAR_ZOOM = 0.2
const FIT_NEW_BOARD = { padding: 0.16, maxZoom: 1 }
const viewportCenter = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

const NEW_NODES = {
  frame: { width: 480, height: 320, data: { title: '' } },
  sticky: { width: 200, height: 200, data: { text: '', color: 'yellow' } },
  text: { width: 240, height: undefined, data: { text: '' } },
} as const

const LIVE_NOTICE: Partial<Record<LiveStatus, string>> = {
  unavailable: 'Live connection unavailable. Viewing the last saved version.',
  reconnecting: 'Reconnecting…',
  unsaved: 'Not saved yet. Changes are kept in this tab.',
  full: 'This board is full right now.',
}
const GUEST_FULL = 'Many people are viewing this board. It updates every few seconds.'

export function BoardCanvas({
  board,
  viewer,
  onAccessChanged,
  guest,
}: {
  board: Board
  viewer: boolean
  onAccessChanged: () => void
  /** Set when the board is shown by its public link: view-only, no socket, no people. */
  guest?: Guest
}) {
  const me =
    useQuery({ queryKey: ['auth'], queryFn: getAuthStatus, enabled: !guest }).data?.me ?? undefined
  const planningData = usePlanningQuery(!guest).data
  const queryClient = useQueryClient()
  useEffect(() => {
    const reread = () => queryClient.invalidateQueries({ queryKey: PLANNING_KEY })
    window.addEventListener(PLANNING_CHANGED_EVENT, reread)
    return () => window.removeEventListener(PLANNING_CHANGED_EVENT, reread)
  }, [queryClient])
  const guestPlanning = guest?.planning
  const planning = useMemo(
    () =>
      guest
        ? {
            enabled: Boolean(guestPlanning),
            types: guestPlanning?.types ?? [],
            people: guestPlanning?.people ?? [],
            fields: guestPlanning?.fields ?? [],
            views: [],
            daysOff: guestPlanning?.daysOff ?? [],
          }
        : {
            enabled: planningData?.enabled ?? false,
            types: planningData?.types ?? [],
            people: planningData?.people ?? [],
            fields: planningData?.fields ?? [],
            views: planningData?.views ?? [],
            daysOff: planningData?.daysOff ?? [],
          },
    [guest, guestPlanning, planningData],
  )
  const live = useLiveBoard(
    board,
    viewer,
    onAccessChanged,
    me,
    guest && `${guest.token}/live/${guest.room}`,
  )
  const liveNotice = guest && live.status === 'full' ? GUEST_FULL : LIVE_NOTICE[live.status]
  const onLive = guest?.onLive
  useEffect(() => onLive?.(live.status === 'live'), [onLive, live.status])
  const { nodes, setNodes, onNodesChange, edges, setEdges, onEdgesChange } = live
  // Until the first sync the saved board is shown and cannot be edited.
  const readOnly = viewer || !live.editable
  // Each person keeps their own view of a board; one they have not opened here fits its content.
  const [lastView] = useState(() => readViewport(board.id))
  const [added, setAdded] = useState<Record<string, Task>>({})
  const [tool, setTool] = useState<Tool>('select')
  const [minimapShown, setMinimapShown] = useState(readMinimapShown)
  const toggleMinimap = () => {
    saveMinimapShown(!minimapShown)
    setMinimapShown(!minimapShown)
  }
  const [connecting, setConnecting] = useState(false)
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const refresh = useRefresh(board.id, { background: !guest && waitsForStatus(nodes), guest })
  const tasks = useMemo(
    () => indexTasks(newest([board.tasks, added, refresh.data?.tasks ?? {}]), board.default_source),
    [board.tasks, board.default_source, added, refresh.data],
  )
  const mixed = hasMixedSources(nodes, board.default_source)
  const boardSources = useMemo(
    () => ({ mixed, defaultSource: board.default_source }),
    [mixed, board.default_source],
  )
  const flow = useReactFlow<AppNode, AppEdge>()
  const { screenToFlowPosition, deleteElements, getNodes, getEdges } = flow
  const theme = useTheme().resolved
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rectangle')
  // Frames and shapes are drawn by dragging; the other creation tools place on a click.
  const drawing = tool === 'frame' || tool === 'shape'
  const placing = drawing || tool === 'sticky' || tool === 'text' || tool === 'timer'
  // Last pointer position over the canvas, where pasted items land.
  const pointer = useRef<XYPosition | null>(null)
  // Screen point where the current arrow drag started.
  const connectFrom = useRef<XYPosition | null>(null)

  useShortcut('cancel', () => setTool('select'), { preventDefault: false })

  const canGoBack = useCanGoBack()
  useEffect(() => forgetViews, [])
  const goBack = () => {
    const view = takeView()
    if (view) void flow.setViewport(view, { duration: reducedMotion() ? 0 : 400 })
  }
  useShortcut('back', goBack, { enabled: canGoBack && !expandedId })

  const flashId = useFlashingId()
  const hits = useSearchHits()
  const { drags } = live
  const originOf = useCallback(
    (id: string) => flow.getInternalNode(id)?.internals.positionAbsolute,
    [flow],
  )
  // Other people's moves in progress; arrows and everything else placed from a node follow.
  const far = useStore((state) => state.transform[2] <= FAR_ZOOM)
  const moving = useRemoteMotion(nodes, drags, live.glide, originOf, useBoardTravel())
  // A style tried on the selection from the bar: drawn here only, never saved or sent.
  const [preview, setPreview] = useState<Style | null>(null)
  const shown = useMemo(() => {
    const painted =
      preview === null ? moving : moving.map((n) => (n.selected ? withStyle(n, preview) : n))
    const raised = raiseAnchors(painted.map(withHandles), edges)
    if (!flashId && !hits) return raised
    return {
      ...raised,
      nodes: raised.nodes.map((n) => {
        // A timer flashes its own cube; any other node the board moved to flashes its frame.
        const flash = n.id === flashId && n.type !== 'timer'
        const hit = hits?.has(n.id)
        if (!flash && !hit) return n
        return {
          ...n,
          className: [n.className, flash && 'node-flash', hit && 'search-hit']
            .filter(Boolean)
            .join(' '),
        }
      }),
    }
  }, [moving, preview, edges, flashId, hits])

  // What the others see of this person: what is selected, and nodes on their way while dragged.
  const { presence } = live
  const selectedKey = nodes
    .filter((n) => n.selected)
    .map((n) => n.id)
    .join(' ')
  useEffect(() => {
    presence.selected(selectedKey ? selectedKey.split(' ') : [])
  }, [presence, selectedKey])
  useEffect(() => {
    const dragged = nodes.filter((n) => n.dragging)
    if (dragged.length === 0 || dragged.length > MAX_LIVE_DRAG) {
      presence.drag(null)
      return
    }
    presence.drag(
      Object.fromEntries(
        dragged.map((n) => [
          n.id,
          flow.getInternalNode(n.id)?.internals.positionAbsolute ?? n.position,
        ]),
      ),
    )
  }, [presence, nodes, flow])
  const guides = useGuides(onNodesChange)
  const touch = useTouchSelect()
  const zoomOnWheel = useWheel() === 'zoom'
  const surfaceRef = useRef<HTMLDivElement>(null)
  useShiftWheelPan(surfaceRef, zoomOnWheel)
  const { nodes: touchNodes, edges: touchEdges } = touch
  const onNodesChangeShown = useMemo(
    () => touchNodes(guides.onNodesChange),
    [touchNodes, guides.onNodesChange],
  )
  const onEdgesChangeShown = useMemo(() => touchEdges(onEdgesChange), [touchEdges, onEdgesChange])
  useShortcut('undo', live.undo, { enabled: !readOnly, ignoreEventWhen: dialogOverBoard })
  useShortcut('redo', live.redo, { enabled: !readOnly, ignoreEventWhen: dialogOverBoard })

  // Cards placed on a guess, closed up once measured; quick enough to stay one undo step.
  const closeUp = useRef<{
    ids: string[]
    center: XYPosition
    at: XYPosition[]
    since: number
  } | null>(null)
  useEffect(() => {
    const pending = closeUp.current
    if (!pending) return
    if (performance.now() - pending.since > CLOSE_UP_MS) {
      closeUp.current = null
      return
    }
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const sizes = pending.ids.map((id) => byId.get(id)?.measured)
    if (sizes.some((s) => !s?.width || !s?.height)) return
    closeUp.current = null
    const target = columnPositions(
      sizes.map((s) => ({ width: s?.width ?? 0, height: s?.height ?? 0 })),
      pending.center,
    )
    const shift = new Map(
      pending.ids.map((id, i) => [
        id,
        { x: target[i].x - pending.at[i].x, y: target[i].y - pending.at[i].y },
      ]),
    )
    // A shift, not a position: a card may already sit in a frame, relative to it.
    setNodes((current) =>
      reparent(
        current.map((n) => {
          const d = shift.get(n.id)
          return d ? { ...n, position: { x: n.position.x + d.x, y: n.position.y + d.y } } : n
        }),
        pending.ids,
      ),
    )
  }, [nodes, setNodes])

  // One card goes to the point or cascades from the viewport center; several form columns there.
  const addCards = useCallback(
    (list: Task[], at?: XYPosition) => {
      didOnboarding('add_card')
      setAdded((current) => ({
        ...current,
        ...Object.fromEntries(list.map((t) => [taskRef(t), t])),
      }))
      const center = screenToFlowPosition(at ?? viewportCenter())
      // Ids and the close-up are set out here: React may run the updater twice.
      const ids = list.map(() => newId())
      const guess = columnPositions(
        list.map(() => CARD_GUESS),
        center,
      )
      if (list.length > 1) closeUp.current = { ids, center, at: guess, since: performance.now() }
      setNodes((current) => {
        const step = current.length % 5
        const positions =
          list.length > 1
            ? guess
            : [
                at
                  ? center
                  : { x: center.x - 128 + step * CASCADE_X, y: center.y - 200 + step * CASCADE_Y },
              ]
        const fresh: AppNode[] = list.map((task, i) => ({
          id: ids[i],
          type: 'task_card',
          position: positions[i],
          data: { key: task.key, source: task.source, collapsed: false },
        }))
        return reparent([...current, ...fresh], ids)
      })
    },
    [screenToFlowPosition, setNodes],
  )

  // A new frame takes in the loose elements under it, as if they had been dropped there.
  const addFrame = (frame: AppNode) =>
    setNodes((current) =>
      reparent(
        framesFirst([...current, frame]),
        current.filter((n) => n.type !== 'frame' && !n.parentId).map((n) => n.id),
      ),
    )

  const insert = (snippet: Snippet, delta: XYPosition) => {
    const copy = cloneSnippet(snippet, delta)
    setAdded((current) => ({ ...current, ...copy.tasks }))
    setNodes((current) =>
      reparent(
        framesFirst([...current.map((n) => ({ ...n, selected: false })), ...copy.nodes]),
        copy.nodes.filter((n) => !n.parentId).map((n) => n.id),
      ),
    )
    setEdges((current) => [...current.map((e) => ({ ...e, selected: false })), ...copy.edges])
  }

  const addPastedNote = (text: string, screen: XYPosition) => {
    const kind = readPasteAs()
    const { width, height, data } = NEW_NODES[kind]
    const point = screenToFlowPosition(screen)
    const node = {
      id: newId(),
      type: kind,
      position: { x: point.x - width / 2, y: point.y - (height ?? 0) / 2 },
      width,
      ...(height ? { height } : { initialHeight: 28 }),
      selected: true,
      data: { ...data, text: kind === 'sticky' ? text.slice(0, STICKY_MAX_CHARS) : text },
    } as AppNode
    setNodes((current) =>
      reparent([...current.map((n) => ({ ...n, selected: false })), node], [node.id]),
    )
  }

  // Native clipboard events rather than shortcuts: only they can read and write the
  // system clipboard. Both step aside for text fields, dialogs and selected page text.
  const clipboard = useRef<Record<'copy' | 'cut' | 'paste', (event: ClipboardEvent) => void>>(null)
  const cutting = useRef(false)
  useEffect(() => {
    const copy = (event: ClipboardEvent) => {
      if (isEditable(event.target) || !window.getSelection()?.isCollapsed) return false
      const snippet = copySelection(getNodes(), getEdges(), tasks)
      if (!snippet) return false
      event.preventDefault()
      event.clipboardData?.setData(CLIPBOARD_MARKER, setClipboard(snippet))
      return true
    }
    clipboard.current = {
      copy,
      cut: (event) => {
        if (readOnly || expandedId) return
        if (!copy(event)) return
        // The copy holds a frame's children too, so they leave with it instead of staying behind.
        cutting.current = true
        void deleteElements({
          nodes: getNodes().filter((n) => n.selected),
          edges: getEdges().filter((e) => e.selected),
        }).finally(() => {
          cutting.current = false
        })
      },
      paste: (event) => {
        if (readOnly || isEditable(event.target) || !event.clipboardData) return
        const paste = classifyPaste(event.clipboardData, clipboardId())
        if (!paste) return
        event.preventDefault()
        const screen = pointer.current ?? viewportCenter()
        const snippet = getClipboard()
        if (paste.kind === 'elements' && snippet) {
          const target = screenToFlowPosition(screen)
          const origin = snippetOrigin(snippet)
          insert(snippet, { x: target.x - origin.x, y: target.y - origin.y })
        } else if (paste.kind === 'refs') {
          if (paste.more)
            toast(`Adding the first ${MAX_REFS} tasks`, {
              description: `Paste the rest separately: up to ${MAX_REFS} at a time.`,
            })
          void resolveAll(paste.refs).then(({ tasks: found, failed }) => {
            if (found.length > 0) {
              addCards(found, screen)
              didOnboarding('paste_link')
            }
            if (failed.length > 0)
              toast.error('Not added', {
                description: failed.map((f) => `${f.ref}: ${f.message}`).join('\n'),
                duration: ERROR_MS,
              })
          })
        } else if (paste.kind === 'text') {
          addPastedNote(paste.text, screen)
        }
      },
    }
  })
  useEffect(() => {
    const copy = (event: ClipboardEvent) => clipboard.current?.copy(event)
    const cut = (event: ClipboardEvent) => clipboard.current?.cut(event)
    const paste = (event: ClipboardEvent) => clipboard.current?.paste(event)
    document.addEventListener('copy', copy)
    document.addEventListener('cut', cut)
    document.addEventListener('paste', paste)
    return () => {
      document.removeEventListener('copy', copy)
      document.removeEventListener('cut', cut)
      document.removeEventListener('paste', paste)
    }
  }, [])
  const duplicate = () => {
    const snippet = copySelection(nodes, edges, tasks)
    if (snippet) insert(snippet, { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET })
  }
  useShortcut('duplicate', duplicate, { enabled: !readOnly })
  useShortcut('selectAll', () => {
    setNodes((current) => current.map((n) => ({ ...n, selected: true })))
    setEdges((current) => current.map((e) => ({ ...e, selected: true })))
  })

  // A timer placed on an element attaches to it; on an empty spot it stays free.
  const addTimer = (at: { screen: XYPosition } | { holder: AppNode }) => {
    // Clicks are the gestures browsers need for the permission prompt and for sound.
    void askNotify()
    primeAudio()
    const id = newId()
    didOnboarding('set_timer')
    const base = { id, type: 'timer', width: TIMER_SIZE, height: TIMER_SIZE } as const
    const data = newTimer(Date.now())
    markFresh(id)
    if ('holder' in at) {
      const node: AppNode = { ...base, parentId: at.holder.id, position: BESIDE, data }
      return setNodes((current) => [...current, node])
    }
    const point = screenToFlowPosition(at.screen)
    const position = { x: point.x - TIMER_SIZE / 2, y: point.y - TIMER_SIZE / 2 }
    setNodes((current) =>
      reparent(dropTimers([...current, { ...base, position, data }], [id]), [id]),
    )
  }

  const updateTimer = useCallback(
    (id: string, change: (data: TimerData) => TimerData) =>
      setNodes((current) =>
        current.map((n) =>
          n.id === id && n.type === 'timer' ? { ...n, data: change(n.data) } : n,
        ),
      ),
    [setNodes],
  )
  const openTimer = useCallback(
    (id: string) => {
      rememberView(flow.getViewport())
      flyTo(flow, id)
    },
    [flow],
  )

  const placeAt = (kind: PlaceTool, screen: XYPosition) => {
    if (kind === 'timer') return addTimer({ screen })
    const { width, height, data } = NEW_NODES[kind]
    const point = screenToFlowPosition(screen)
    const node = {
      id: newId(),
      type: kind,
      position: { x: point.x - width / 2, y: point.y - (height ?? 0) / 2 },
      width,
      // Text grows with its content; initialHeight shows it before measuring, so the editor can focus.
      ...(height ? { height } : { initialHeight: 28 }),
      data: { ...data },
    } as AppNode
    if (kind === 'frame') return addFrame(node)
    markFresh(node.id)
    setNodes((current) => reparent([...current, node], [node.id]))
  }

  // Cards dropped on a module that takes them join it; the rest may change frames.
  const dropNodes = (ids: string[]) => {
    // The store has the final drag position; this render's nodes may not yet.
    const current = getNodes()
    const result = absorbCards(current, ids, planning)
    let kept = result?.nodes ?? current
    if (result?.absorbed.size) didOnboarding('gantt_task')
    if (result) {
      const edgesLeft = getEdges().filter(
        (e) => !result.absorbed.has(e.source) && !result.absorbed.has(e.target),
      )
      setEdges(edgesLeft)
      const orphans = new Set(orphanAnchors(kept, edgesLeft).map((n) => n.id))
      kept = kept.filter((n) => !orphans.has(n.id))
    }
    const left = ids.filter((id) => !result?.absorbed.has(id))
    const next = reparent(dropTimers(kept, left), left)
    // The store still says dragging, and xyflow puts a dragging node into every marquee.
    setNodes(next.map((n) => (n.dragging ? { ...n, dragging: false } : n)))
  }

  const moduleHost = useMemo<ModuleHost>(
    () => ({
      addTasks: (list) =>
        setAdded((current) => ({
          ...current,
          ...Object.fromEntries(list.map((t) => [taskRef(t), t])),
        })),
      ejectCard: (task, screen) => {
        const node: AppNode = {
          id: newId(),
          type: 'task_card',
          position: screenToFlowPosition(screen),
          data: { ...task, collapsed: false },
        }
        setNodes((current) => reparent([...current, node], [node.id]))
      },
      ejectNote: (text, screen) => {
        const { width, height } = NEW_NODES.sticky
        const point = screenToFlowPosition(screen)
        const node: AppNode = {
          id: newId(),
          type: 'sticky',
          position: { x: point.x - width / 2, y: point.y - height / 2 },
          width,
          height,
          data: { text, color: 'yellow' },
        }
        setNodes((current) => reparent([...current, node], [node.id]))
      },
    }),
    [screenToFlowPosition, setNodes],
  )

  const addModule = (kind: string, screen: XYPosition) => {
    const def = findModule(kind)
    if (!def) return
    const { width, height } = def.size
    const point = screenToFlowPosition(screen)
    const node: AppNode = {
      id: newId(),
      type: 'module',
      position: { x: point.x - width / 2, y: point.y - height / 2 },
      width,
      height,
      data: { kind, content: def.defaults() },
    }
    setNodes((current) => [
      ...current.map((n) => ({ ...n, selected: false })),
      { ...node, selected: true },
    ])
  }

  const drawFrame = ({ x, y, width, height }: ScreenRect) => {
    setTool('select')
    if (width < MIN_DRAW || height < MIN_DRAW) return placeAt('frame', { x, y })
    const start = screenToFlowPosition({ x, y })
    const end = screenToFlowPosition({ x: x + width, y: y + height })
    addFrame({
      id: newId(),
      type: 'frame',
      position: start,
      width: Math.max(end.x - start.x, MIN_FRAME.width),
      height: Math.max(end.y - start.y, MIN_FRAME.height),
      data: { title: '' },
    })
  }
  // A drag sets the size; a click places the default size centered on the point.
  const drawShape = ({ x, y, width, height }: ScreenRect) => {
    setTool('select')
    const start = screenToFlowPosition({ x, y })
    const end = screenToFlowPosition({ x: x + width, y: y + height })
    const sized = drawn({ width, height })
    const size = sized
      ? {
          width: Math.max(end.x - start.x, SHAPE_MIN.width),
          height: Math.max(end.y - start.y, SHAPE_MIN.height),
        }
      : SHAPE_SIZE
    const node: AppNode = {
      id: newId(),
      type: 'shape',
      position: sized ? start : { x: start.x - size.width / 2, y: start.y - size.height / 2 },
      ...size,
      data: { shape: shapeKind, text: '', color: 'none' },
    }
    markFresh(node.id)
    setNodes((current) => reparent([...current, node], [node.id]))
  }
  const draw = useDrawRect(drawing, tool === 'shape' ? drawShape : drawFrame)

  // A creation tool places its element where the user clicks, then hands back to Select.
  // Frames and shapes are drawn by dragging instead.
  const place = (event: { clientX: number; clientY: number }) => {
    if (!placing || drawing) return
    placeAt(tool, { x: event.clientX, y: event.clientY })
    setTool('select')
  }

  // Right-clicking an unselected element selects just it, like tldraw.
  const selectOnly = (id: string, kind: 'node' | 'edge') => {
    setNodes((current) => current.map((n) => ({ ...n, selected: kind === 'node' && n.id === id })))
    setEdges((current) => current.map((e) => ({ ...e, selected: kind === 'edge' && e.id === id })))
  }

  const openNodeMenu = (node: AppNode) => {
    if (readOnly) return
    if (!node.selected) selectOnly(node.id, 'node')
    setMenuTarget({ kind: 'selection' })
  }

  // Node handlers keep one identity: a new one redraws every node on each frame of a remote drag.
  const nodeEvents = useRef({ place, openNodeMenu })
  useLayoutEffect(() => {
    nodeEvents.current = { place, openNodeMenu }
  })
  const onNodeClick = useCallback((event: ReactMouseEvent) => nodeEvents.current.place(event), [])
  // Far out an element has no editor: a double-click zooms in at that point, like on the empty board.
  const onNodeDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      const { x, y, zoom } = flow.getViewport()
      if (zoom > FAR_ZOOM) return
      const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const next = zoom * 2
      void flow.setViewport(
        { x: x + at.x * (zoom - next), y: y + at.y * (zoom - next), zoom: next },
        { duration: reducedMotion() ? 0 : 200 },
      )
    },
    [flow],
  )
  const onNodeContextMenu = useCallback(
    (_: ReactMouseEvent, node: AppNode) => nodeEvents.current.openNodeMenu(node),
    [],
  )

  const selectNodes = (ids: string[]) => {
    const picked = new Set(ids)
    setNodes((current) => current.map((n) => ({ ...n, selected: picked.has(n.id) })))
    setEdges((current) => current.map((e) => ({ ...e, selected: false })))
  }

  const jumpTo = (id: string) => {
    selectOnly(id, 'node')
    flyTo(flow, id)
  }

  const selectedCards = nodes.filter(
    (n): n is TaskCardNodeType => n.selected === true && n.type === 'task_card',
  )
  const collapsedCount = selectedCards.filter((n) => n.data.collapsed).length
  const cardCounts = {
    collapsed: collapsedCount,
    expanded: selectedCards.length - collapsedCount,
  }
  const setCollapsed = (collapsed: boolean) =>
    setNodes((current) =>
      current.map((n) =>
        n.selected && n.type === 'task_card' ? { ...n, data: { ...n.data, collapsed } } : n,
      ),
    )

  // One call, so a style on many elements is one undo step.
  const setStyle = (style: Style) =>
    setNodes((current) => current.map((n) => (n.selected ? withStyle(n, style) : n)))
  const align = (how: Alignment | Distribution) =>
    setNodes((current) => {
      const moving = movers(current)
      if (moving.length < 2) return current
      const boxes = boxesOf(moving, current)
      const shifts =
        how === 'horizontal' || how === 'vertical'
          ? distributeShifts(boxes, how)
          : alignShifts(boxes, how)
      // Like a drop: an element that lands in a frame or leaves one changes frame.
      return reparent(
        applyShifts(current, shifts),
        moving.map((n) => n.id),
      )
    })
  const narrowTo = (kind: Kind) => {
    setNodes((current) =>
      current.map((n) => (n.selected && n.type !== kind ? { ...n, selected: false } : n)),
    )
    setEdges((current) => current.map((e) => (e.selected ? { ...e, selected: false } : e)))
  }

  const selected = nodes.filter((n) => n.selected)
  const expandedNode = nodes.find(
    (n): n is ModuleNodeType => n.id === expandedId && n.type === 'module',
  )
  const inBar = barNodes(nodes)
  // Hidden while the selection moves or changes size: it would cover the guides and the neighbors.
  const barShown =
    !readOnly &&
    !placing &&
    !expandedNode &&
    inBar.length > 0 &&
    !nodes.some((n) => n.dragging || n.resizing)
  const timerHolder = selected.length === 1 && holdsTimers(selected[0]) ? selected[0] : undefined
  const soleSelected = inBar.length === 1 ? inBar[0] : undefined
  const controls =
    soleSelected?.type === 'module'
      ? (side: 'top' | 'bottom') =>
          moduleControls(
            soleSelected,
            (content) => flow.updateNodeData(soleSelected.id, { content }),
            side,
          )
      : undefined

  const deleteSelection = () =>
    void deleteElements({
      nodes: nodes.filter((n) => n.selected),
      edges: edges.filter((e) => e.selected),
    })

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((current) => addEdge({ ...connection, id: newId() }, current)),
    [setEdges],
  )

  // An arrow released over empty space points there: it ends at a new anchor.
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      setConnecting(false)
      const start = connectFrom.current
      connectFrom.current = null
      if (state.isValid || !state.fromNode || !state.fromHandle || !state.from || !start) return
      const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event
      if (Math.hypot(clientX - start.x, clientY - start.y) < MIN_ARROW) return
      const { node, side } = anchorAt(
        newId(),
        state.from,
        screenToFlowPosition({ x: clientX, y: clientY }),
      )
      setNodes((current) => reparent([...current, node], [node.id]))
      setEdges((current) => [
        ...current,
        {
          id: newId(),
          source: state.fromNode.id,
          sourceHandle: state.fromHandle.id,
          target: node.id,
          targetHandle: side,
        },
      ])
    },
    [screenToFlowPosition, setNodes, setEdges],
  )

  // Deleting a frame keeps its children: only what the user selected goes away.
  // An anchor goes with the last arrow that ends at it.
  const onBeforeDelete: OnBeforeDelete<AppNode, AppEdge> = useCallback(
    async ({ nodes: doomed, edges: doomedEdges }) => {
      const split = cutting.current ? null : splitDeletion(doomed, doomedEdges)
      if (split) {
        setNodes((current) => releaseChildren(current, new Set(split.nodes.map((n) => n.id))))
      }
      const plan = split ?? { nodes: doomed, edges: doomedEdges }
      const goneNodes = new Set(plan.nodes.map((n) => n.id))
      const goneEdges = new Set(plan.edges.map((e) => e.id))
      const edgesLeft = getEdges().filter(
        (e) => !goneEdges.has(e.id) && !goneNodes.has(e.source) && !goneNodes.has(e.target),
      )
      const orphans = orphanAnchors(
        getNodes().filter((n) => !goneNodes.has(n.id)),
        edgesLeft,
      )
      if (!split && orphans.length === 0) return true
      return { nodes: [...plan.nodes, ...orphans], edges: plan.edges }
    },
    [setNodes, getNodes, getEdges],
  )

  const surface = (
    <div
      ref={surfaceRef}
      className="absolute inset-0"
      onPointerMove={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY }
        presence.cursor(screenToFlowPosition(pointer.current))
      }}
      onPointerLeave={() => {
        pointer.current = null
        presence.cursor(null)
      }}
      onPointerDownCapture={draw.onPointerDownCapture}
      onPointerMoveCapture={touch.onPointerMoveCapture}
    >
      <ReactFlow
        nodes={shown.nodes}
        edges={shown.edges}
        onNodesChange={onNodesChangeShown}
        onEdgesChange={onEdgesChangeShown}
        onSelectionEnd={touch.onSelectionEnd}
        onConnect={onConnect}
        onConnectStart={(event) => {
          setConnecting(true)
          const { clientX, clientY } = 'touches' in event ? event.touches[0] : event
          connectFrom.current = { x: clientX, y: clientY }
        }}
        onConnectEnd={onConnectEnd}
        onNodeDragStop={(_, __, dragged) => dropNodes(dragged.map((n) => n.id))}
        onBeforeDelete={onBeforeDelete}
        onPaneClick={place}
        onPaneContextMenu={(event) =>
          !readOnly &&
          setMenuTarget({ kind: 'pane', point: { x: event.clientX, y: event.clientY } })
        }
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={(_, edge) => {
          if (readOnly) return
          if (!edge.selected) selectOnly(edge.id, 'edge')
          setMenuTarget({ kind: 'selection' })
        }}
        onSelectionContextMenu={() => !readOnly && setMenuTarget({ kind: 'selection' })}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onMoveEnd={(_, viewport) => saveViewport(board.id, viewport)}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionMode={ConnectionMode.Loose}
        defaultViewport={lastView ?? undefined}
        fitView={lastView === null}
        fitViewOptions={FIT_NEW_BOARD}
        onlyRenderVisibleElements
        // Selecting must not restack: a frame someone selects would cover, for them alone, what
        // everyone else sees lying on top of it.
        elevateNodesOnSelect={false}
        colorMode={theme}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        // An expanded module covers the board: Backspace there must not delete the selection.
        deleteKeyCode={readOnly || expandedNode ? null : ['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        selectionOnDrag={tool === 'select'}
        selectionMode={SelectionMode.Partial}
        panOnDrag={tool === 'hand' ? true : [1]}
        panOnScroll={!zoomOnWheel}
        elementsSelectable={!placing}
        nodesDraggable={!placing && !readOnly}
        nodesConnectable={!readOnly}
        edgesReconnectable={!readOnly}
        style={placing ? { cursor: toolCursor(tool) } : undefined}
        className={[
          connecting && 'connecting',
          hits && 'searching',
          tool === 'hand' && 'cursor-grab',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} color="var(--grid)" />
        {/* One column, so the minimap stays above the zoom buttons however many there are. */}
        <Panel position="bottom-right" className="canvas-corner">
          {minimapShown && <Minimap />}
          <Controls showInteractive={false}>
            {canGoBack && (
              <ControlButton
                onClick={goBack}
                title="Back to where you were (B)"
                aria-label="Back to where you were"
              >
                <ArrowLeft />
              </ControlButton>
            )}
            <ControlButton
              className="max-sm:hidden"
              onClick={toggleMinimap}
              title={minimapShown ? 'Hide minimap' : 'Show minimap'}
              aria-label={minimapShown ? 'Hide minimap' : 'Show minimap'}
              aria-pressed={minimapShown}
            >
              {/* xyflow fills control icons; a closed outline must stay an outline. */}
              <MapIcon style={{ fill: 'none' }} />
            </ControlButton>
          </Controls>
        </Panel>
        <Guides guides={guides.guides} />
        <PresenceLayer />
      </ReactFlow>
      {barShown && (
        <SelectionBar
          nodes={inBar}
          onStyle={setStyle}
          onPreview={setPreview}
          onNarrow={narrowTo}
          onCollapse={setCollapsed}
          movable={movers(nodes).length}
          onAlign={align}
          onAddTimer={timerHolder && (() => addTimer({ holder: timerHolder }))}
          onDuplicate={duplicate}
          onDelete={deleteSelection}
          controls={controls}
        />
      )}
      {tool === 'shape' && (
        <ShapeGhost
          kind={shapeKind}
          rect={draw.preview && drawn(draw.preview) ? draw.preview : null}
          start={() => pointer.current}
        />
      )}
      {tool !== 'shape' && draw.preview && (
        <div
          className="border-primary bg-primary/5 pointer-events-none fixed rounded-sm border border-dashed"
          style={{
            left: draw.preview.x,
            top: draw.preview.y,
            width: draw.preview.width,
            height: draw.preview.height,
          }}
        />
      )}
    </div>
  )

  const indicator = (
    <RefreshIndicator
      sources={refresh.data?.sources ?? []}
      serverError={refresh.error}
      syncedAt={lastSynced(refresh.data?.sources ?? []) || lastFetched(board.tasks)}
      refreshing={refresh.isFetching}
      onRefresh={() => void refresh.refetch()}
    />
  )

  return (
    <TasksContext.Provider value={tasks}>
      <PlanningContext.Provider value={planning}>
        <BoardSourcesContext.Provider value={boardSources}>
          <ReadOnlyContext.Provider value={readOnly}>
            <FarContext.Provider value={far}>
              <SelectedByContext.Provider value={live.selections}>
                <ModuleHostContext.Provider value={moduleHost}>
                  <ExpandModuleContext.Provider value={setExpandedId}>
                    {readOnly ? (
                      surface
                    ) : (
                      <CanvasContextMenu
                        target={menuTarget}
                        onPlace={placeAt}
                        onAddCards={addCards}
                        onAddModule={addModule}
                        onDelete={deleteSelection}
                        cards={cardCounts}
                        onCollapse={setCollapsed}
                        onAddTimer={timerHolder && (() => addTimer({ holder: timerHolder }))}
                      >
                        {surface}
                      </CanvasContextMenu>
                    )}
                    {expandedNode && (
                      <ModuleExpanded
                        node={expandedNode}
                        readOnly={readOnly}
                        onChange={(content) => flow.updateNodeData(expandedNode.id, { content })}
                        onClose={() => setExpandedId(null)}
                      />
                    )}
                  </ExpandModuleContext.Provider>
                </ModuleHostContext.Provider>
              </SelectedByContext.Provider>
              {guest ? (
                // Timers on the board are its people's reminders: a guest sees them, nothing rings.
                <div ref={topOverlay} className="absolute top-4 right-4 z-10">
                  {indicator}
                </div>
              ) : (
                <BoardTimers nodes={nodes} tasks={tasks} onOpen={openTimer} onChange={updateTimer}>
                  {indicator}
                </BoardTimers>
              )}
              <BoardSearch
                boardId={board.id}
                nodes={nodes}
                tasks={tasks}
                onJump={jumpTo}
                onSelect={selectNodes}
              />
              {liveNotice && (
                <Alert
                  variant={live.status === 'unsaved' ? 'destructive' : 'default'}
                  className="absolute top-16 right-4 z-10 w-80"
                >
                  <AlertDescription>{liveNotice}</AlertDescription>
                </Alert>
              )}
              {!readOnly && (
                <Toolbar
                  tool={tool}
                  onTool={setTool}
                  onShape={(kind) => {
                    setShapeKind(kind)
                    setTool('shape')
                  }}
                  onAddCards={addCards}
                  onAddModule={(kind) => addModule(kind, viewportCenter())}
                />
              )}
            </FarContext.Provider>
          </ReadOnlyContext.Provider>
        </BoardSourcesContext.Provider>
      </PlanningContext.Provider>
    </TasksContext.Provider>
  )
}

export default function Canvas({ boardId }: { boardId: string }) {
  const queryClient = useQueryClient()
  const board = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => getBoard(boardId),
    staleTime: Infinity,
    gcTime: 0,
  })

  // The server closed the socket because this person's access changed: read the role again.
  const [accessChanged, setAccessChanged] = useState(false)
  const onAccessChanged = useCallback(() => {
    setAccessChanged(true)
    void queryClient.invalidateQueries({ queryKey: ['board', boardId] })
    void queryClient.invalidateQueries({ queryKey: ['boards'] })
    // The account itself may be what changed: a role, or a demo visitor who signed up in another tab.
    void queryClient.invalidateQueries({ queryKey: ['auth'] })
  }, [queryClient, boardId])

  // The board is gone for this person: the app moves on to another one and says why.
  const lost = accessChanged && board.isError
  useEffect(() => {
    // The id keeps it to one toast when the effect runs twice.
    if (lost)
      toast('You no longer have access to this board.', { id: 'board-lost', duration: ERROR_MS })
  }, [lost])

  if (board.isPending) return <Skeleton className="absolute inset-0" />
  if (board.isError) {
    return (
      <Alert variant="destructive" className="absolute top-20 left-1/2 w-96 -translate-x-1/2">
        <AlertDescription>{board.error.message}</AlertDescription>
      </Alert>
    )
  }
  const viewer = !canEdit(board.data.my_role)
  return (
    <ReactFlowProvider>
      {accessChanged && viewer && (
        <Alert ref={topOverlay} className="absolute top-4 left-1/2 z-10 w-96 -translate-x-1/2">
          <AlertDescription>You can only view this board now.</AlertDescription>
        </Alert>
      )}
      <BoardCanvas
        // A new role is a new connection with new rights.
        key={`${board.data.id}:${board.data.my_role}`}
        board={board.data}
        viewer={viewer}
        onAccessChanged={onAccessChanged}
      />
    </ReactFlowProvider>
  )
}
