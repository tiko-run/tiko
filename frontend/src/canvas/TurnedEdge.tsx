import { BaseEdge, Position, useInternalNode, type EdgeProps, type XYPosition } from '@xyflow/react'
import { memo } from 'react'
import { turnVector } from '@/canvas/turn'
import type { Turned } from '@/canvas/types'

const OUT: Record<Position, XYPosition> = {
  [Position.Top]: { x: 0, y: -1 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Bottom]: { x: 0, y: 1 },
  [Position.Left]: { x: -1, y: 0 },
}

// React Flow's own bezier offset, so an arrow between upright elements keeps its shape.
const offset = (distance: number) =>
  distance >= 0 ? 0.5 * distance : 0.25 * 25 * Math.sqrt(-distance)

function control(from: XYPosition, to: XYPosition, side: Position, deg: number): XYPosition {
  const out = turnVector(OUT[side], deg)
  const reach = offset((to.x - from.x) * out.x + (to.y - from.y) * out.y)
  // Rounded: a turned side gives values like 6e-17 that read badly in a path.
  const round = (n: number) => Math.round(n * 100) / 100
  return { x: round(from.x + out.x * reach), y: round(from.y + out.y * reach) }
}

/** A bezier that leaves each end square to its side, turned with the element it is tied to. */
export function turnedBezier(
  source: XYPosition,
  sourceSide: Position,
  sourceTurn: number,
  target: XYPosition,
  targetSide: Position,
  targetTurn: number,
): string {
  const c1 = control(source, target, sourceSide, sourceTurn)
  const c2 = control(target, source, targetSide, targetTurn)
  return `M${source.x},${source.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${target.x},${target.y}`
}

const turnOf = (node: ReturnType<typeof useInternalNode>) =>
  (node?.data as Turned | undefined)?.rotation ?? 0

function TurnedEdgeView(props: EdgeProps) {
  const path = turnedBezier(
    { x: props.sourceX, y: props.sourceY },
    props.sourcePosition,
    turnOf(useInternalNode(props.source)),
    { x: props.targetX, y: props.targetY },
    props.targetPosition,
    turnOf(useInternalNode(props.target)),
  )
  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerStart={props.markerStart}
      markerEnd={props.markerEnd}
      style={props.style}
      interactionWidth={props.interactionWidth}
    />
  )
}

export const TurnedEdge = memo(TurnedEdgeView)
