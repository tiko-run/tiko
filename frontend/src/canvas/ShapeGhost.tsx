import { useViewport, type XYPosition } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { SHAPE_SIZE, shapePath, type ShapeKind } from '@/canvas/shapes'
import type { ScreenRect } from '@/canvas/useDrawRect'

/** The shape about to be placed: under the pointer at its default size, or as large as the drag. */
export function ShapeGhost({ kind, rect }: { kind: ShapeKind; rect: ScreenRect | null }) {
  const { zoom } = useViewport()
  const [point, setPoint] = useState<XYPosition | null>(null)

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const onCanvas = (event.target as Element).closest?.('.react-flow__pane, .react-flow__node')
      setPoint(onCanvas ? { x: event.clientX, y: event.clientY } : null)
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])

  const width = SHAPE_SIZE.width * zoom
  const height = SHAPE_SIZE.height * zoom
  const box = rect ?? (point && { x: point.x - width / 2, y: point.y - height / 2, width, height })
  if (!box) return null

  return (
    <svg
      aria-hidden
      className="text-primary pointer-events-none fixed overflow-visible"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      <path
        d={shapePath(kind, box.width, box.height)}
        fill="currentColor"
        fillOpacity={0.05}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}
