import { MiniMap, useReactFlow, type MiniMapNodeProps } from '@xyflow/react'
import { reducedMotion } from '@/canvas/fly'
import { fillCss, fillOf } from '@/canvas/selection-props'
import type { AppNode } from '@/canvas/types'

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

// Stable references, so the minimap's blocks do not redraw on every render of the board.
const fillOfNode = (node: AppNode) => minimapLook(node).fill
const strokeOfNode = (node: AppNode) => minimapLook(node).stroke

// Outlines stay one screen pixel however large the board is.
function Block({ x, y, width, height, color, strokeColor }: MiniMapNodeProps) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      rx={2}
      fill={color}
      stroke={strokeColor}
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      opacity={color === 'var(--muted-foreground)' ? 0.45 : 1}
    />
  )
}

/** The whole board in the corner: a click moves the view there, dragging the frame pans. */
export function Minimap() {
  const flow = useReactFlow()
  return (
    <MiniMap<AppNode>
      ariaLabel="Minimap"
      className="canvas-minimap max-sm:hidden"
      pannable
      nodeColor={fillOfNode}
      nodeStrokeColor={strokeOfNode}
      nodeComponent={Block}
      onClick={(_, at) =>
        flow.setCenter(at.x, at.y, {
          zoom: flow.getZoom(),
          duration: reducedMotion() ? 0 : 200,
        })
      }
    />
  )
}
