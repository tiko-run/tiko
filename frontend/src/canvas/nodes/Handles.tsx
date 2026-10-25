import { Handle, Position } from '@xyflow/react'
import { useContext } from 'react'
import { FarContext, useReadOnly } from '@/canvas/readonly'

const SIDES = [
  { id: 't', position: Position.Top },
  { id: 'r', position: Position.Right },
  { id: 'b', position: Position.Bottom },
  { id: 'l', position: Position.Left },
]

// With connectionMode="loose" every handle is both a start and an end of an arrow.
// `side` moves the left and right handles inwards, in percent, for an outline that leaves its box there.
export function Handles({ side = 0 }: { side?: number }) {
  // React Flow's nodesConnectable does not reach a Handle: a viewer could still draw arrows.
  const readOnly = useReadOnly()
  // Far out arrows keep their ends from the node's own handles (canvas/handles.ts).
  if (useContext(FarContext)) return null
  const moved = side ? { l: { left: `${side}%` }, r: { right: `${side}%` } } : undefined
  return SIDES.map(({ id, position }) => (
    <Handle
      key={id}
      id={id}
      type="source"
      position={position}
      isConnectable={!readOnly}
      style={moved?.[id as 'l' | 'r']}
    />
  ))
}
