import { useReactFlow, useStore } from '@xyflow/react'
import { RotateCw } from 'lucide-react'
import { useRef, type CSSProperties, type PointerEvent } from 'react'

// Shift turns in these steps, as in most editors.
export const ROTATE_STEP = 15

/** Degrees clockwise from "up" for a point around a center. */
export function pointerAngle(center: { x: number; y: number }, point: { x: number; y: number }) {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90
}

/** The element's new turn after the pointer swept from `from` to `to`, in (-180, 180]. */
export function turnBy(rotation: number, from: number, to: number, snap: boolean): number {
  const step = snap ? ROTATE_STEP : 1
  const turned = Math.round((rotation + to - from) / step) * step
  const normal = ((((turned + 180) % 360) + 360) % 360) - 180
  return normal === -180 ? 180 : normal
}

/** The turn of an element's look; its box, grips and arrow points stay upright. */
export const turned = (rotation: number | undefined): CSSProperties | undefined =>
  rotation ? { transform: `rotate(${rotation}deg)` } : undefined

/** A grip above the element that turns it around its center. */
export function Rotator({
  id,
  rotation,
  isVisible,
}: {
  id: string
  rotation: number | undefined
  isVisible: boolean
}) {
  if (!isVisible) return null
  return <Grip id={id} rotation={rotation ?? 0} />
}

function Grip({ id, rotation }: { id: string; rotation: number }) {
  const zoom = useStore((state) => state.transform[2])
  const { updateNodeData } = useReactFlow()
  const start = useRef<{ angle: number; rotation: number } | null>(null)
  const angleOf = (event: PointerEvent) => {
    const box = event.currentTarget.closest('.react-flow__node')!.getBoundingClientRect()
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    return pointerAngle(center, { x: event.clientX, y: event.clientY })
  }
  return (
    <button
      type="button"
      aria-label="Rotate"
      title="Rotate (Shift: 15° steps)"
      className="nodrag nopan bg-background text-muted-foreground border-primary absolute left-1/2 flex size-5 cursor-grab items-center justify-center rounded-full border active:cursor-grabbing"
      // Under the element, out of the way of the selection bar; same size at any zoom.
      style={{ bottom: -28 / zoom, transform: `translateX(-50%) scale(${1 / zoom})` }}
      onPointerDown={(event) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        start.current = { angle: angleOf(event), rotation }
      }}
      onPointerMove={(event) => {
        if (!start.current) return
        const { angle, rotation: from } = start.current
        updateNodeData(id, { rotation: turnBy(from, angle, angleOf(event), event.shiftKey) })
      }}
      onPointerUp={(event) => {
        start.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    >
      <RotateCw className="size-3" />
    </button>
  )
}
