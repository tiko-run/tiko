import {
  NodeResizer,
  useNodeId,
  useReactFlow,
  useStore,
  useStoreApi,
  type NodeResizerProps,
  type XYPosition,
} from '@xyflow/react'
import { useRef, type CSSProperties, type PointerEvent } from 'react'
import { resizeTurned, type Side } from '@/canvas/turn'

type Props = NodeResizerProps & { rotation?: number }

/** React Flow's NodeResizer whose side grips stay 8 screen pixels wide at any zoom. */
export function Resizer({ isVisible, rotation, ...props }: Props) {
  // Only the selected elements listen to the zoom.
  if (!isVisible) return null
  if (rotation) return <TurnedResizer rotation={rotation} {...props} />
  return <ZoomedResizer {...props} />
}

function ZoomedResizer(props: NodeResizerProps) {
  const zoom = useStore((state) => state.transform[2])
  // On the grips alone: set on the board, the zoom would restyle every element on each step.
  return <NodeResizer {...props} lineStyle={{ '--zoom': zoom } as CSSProperties} />
}

const GRIPS: Side[][] = [
  ['top'],
  ['right'],
  ['bottom'],
  ['left'],
  ['top', 'left'],
  ['top', 'right'],
  ['bottom', 'left'],
  ['bottom', 'right'],
]

/**
 * React Flow's resizer works in board axes; a turned element is resized in its own, as in Miro.
 * It draws inside the turned element, so its grips turn with it. Guides do not snap here.
 */
function TurnedResizer({
  rotation,
  minWidth = 10,
  minHeight = 10,
  keepAspectRatio = false,
}: Omit<NodeResizerProps, 'isVisible'> & { rotation: number }) {
  const id = useNodeId()!
  const zoom = useStore((state) => state.transform[2])
  const store = useStoreApi()
  const { screenToFlowPosition, updateNode } = useReactFlow()
  const start = useRef<{
    sides: Side[]
    box: { x: number; y: number; width: number; height: number }
    position: XYPosition
    pointer: XYPosition
  } | null>(null)

  const down = (sides: Side[]) => (event: PointerEvent) => {
    const node = store.getState().nodeLookup.get(id)
    // Not measured yet, as right after a paste: there is no box to resize from.
    if (!node || event.button !== 0 || !node.measured.width || !node.measured.height) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const { x, y } = node.internals.positionAbsolute
    start.current = {
      sides,
      box: { x, y, width: node.measured.width ?? 0, height: node.measured.height ?? 0 },
      position: node.position,
      pointer: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    }
  }
  const move = (event: PointerEvent) => {
    const from = start.current
    if (!from) return
    const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const travel = { x: pointer.x - from.pointer.x, y: pointer.y - from.pointer.y }
    const next = resizeTurned(
      from.box,
      rotation,
      from.sides,
      travel,
      { width: minWidth, height: minHeight },
      keepAspectRatio,
    )
    updateNode(id, {
      position: {
        x: from.position.x + next.x - from.box.x,
        y: from.position.y + next.y - from.box.y,
      },
      width: next.width,
      height: next.height,
    })
  }
  const up = (event: PointerEvent) => {
    start.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  return GRIPS.map((sides) => {
    const line = sides.length === 1
    return (
      <div
        key={sides.join('-')}
        className={`react-flow__resize-control nodrag ${sides.join(' ')} ${line ? 'line' : 'handle'}`}
        style={line ? ({ '--zoom': zoom } as CSSProperties) : { scale: 1 / zoom }}
        onPointerDown={down(sides)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
      />
    )
  })
}
