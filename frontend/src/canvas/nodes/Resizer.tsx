import { NodeResizer, useStore, type NodeResizerProps } from '@xyflow/react'
import type { CSSProperties } from 'react'

/** React Flow's NodeResizer whose side grips stay 8 screen pixels wide at any zoom. */
export function Resizer({ isVisible, ...props }: NodeResizerProps) {
  // Only the selected elements listen to the zoom.
  if (!isVisible) return null
  return <ZoomedResizer {...props} />
}

function ZoomedResizer(props: NodeResizerProps) {
  const zoom = useStore((state) => state.transform[2])
  // On the grips alone: set on the board, the zoom would restyle every element on each step.
  return <NodeResizer {...props} lineStyle={{ '--zoom': zoom } as CSSProperties} />
}
