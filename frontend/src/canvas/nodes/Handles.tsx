import { Handle, Position } from '@xyflow/react'

const SIDES = [
  { id: 't', position: Position.Top },
  { id: 'r', position: Position.Right },
  { id: 'b', position: Position.Bottom },
  { id: 'l', position: Position.Left },
]

// With connectionMode="loose" every handle is both a start and an end of an arrow.
// `side` moves the left and right handles inwards, in percent, for an outline that leaves its box there.
export function Handles({ side = 0 }: { side?: number }) {
  const moved = side ? { l: { left: `${side}%` }, r: { left: `${100 - side}%` } } : undefined
  return SIDES.map(({ id, position }) => (
    <Handle key={id} id={id} type="source" position={position} style={moved?.[id as 'l' | 'r']} />
  ))
}
