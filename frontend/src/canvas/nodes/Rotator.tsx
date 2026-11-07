import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react'
import { RotateCw } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

// Shift turns in these steps, as in most editors.
export const ROTATE_STEP = 15

/** Degrees clockwise from "up" for a point around a center. */
export function pointerAngle(center: { x: number; y: number }, point: { x: number; y: number }) {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90
}

/** The element's new turn after the pointer swept from `from` to `to`, in (-180, 180]. */
export function turnBy(rotation: number, from: number, to: number, snap: boolean): number {
  const raw = rotation + to - from
  const turned = snap ? Math.round(raw / ROTATE_STEP) * ROTATE_STEP : magnet(raw)
  const normal = ((((turned + 180) % 360) + 360) % 360) - 180
  return normal === -180 ? 180 : normal
}

// Upright, diagonal and upside down pull the element in from this close, so it is easy to set
// straight again; a little further on it lets go.
const MAGNET_STEP = 45
const MAGNET_DEG = 4

function magnet(deg: number): number {
  const near = Math.round(deg / MAGNET_STEP) * MAGNET_STEP
  return Math.abs(deg - near) <= MAGNET_DEG ? near : Math.round(deg)
}

/** Whether a turn sits on one of the angles the grip pulls to. */
export const onMagnet = (deg: number) => deg % MAGNET_STEP === 0

/** The angle as people read it: 0° to 359°, clockwise. */
export const degreesLabel = (deg: number) => `${(deg + 360) % 360}°`

/** The turn of a whole element: its look, grips and arrow points, around its center. */
export const turned = (rotation: number | undefined): CSSProperties | undefined =>
  rotation ? { transform: `rotate(${rotation}deg)` } : undefined

// A turning arrow as the cursor near a corner, as in Miro; the system has none.
const CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="white" stroke-width="5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></g><g stroke="black" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></g></svg>',
)}") 10 10, grab`

// Screen pixels: how big a corner's turning spot is, and how far out from the corner it starts.
const SPOT = 18
const OUT = 4

const CORNERS = [
  { top: true, left: true },
  { top: true, left: false },
  { top: false, left: true },
  { top: false, left: false },
]

/** Arrows meet a turned element where it is drawn, so its arrow points are measured again. */
export function useTurnedHandles(id: string, rotation: number | undefined) {
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => updateNodeInternals(id), [id, rotation, updateNodeInternals])
}

/** Spots just outside the corners that turn the element around its center; one shows an icon. */
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
  return <Spots id={id} rotation={rotation ?? 0} />
}

function Spots({ id, rotation }: { id: string; rotation: number }) {
  const zoom = useStore((state) => state.transform[2])
  const { updateNodeData } = useReactFlow()
  const start = useRef<{ angle: number; rotation: number } | null>(null)
  // Where the pointer is while turning, for the angle shown next to it.
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const angleOf = (event: PointerEvent) => {
    const box = event.currentTarget.closest('.react-flow__node')!.getBoundingClientRect()
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    return pointerAngle(center, { x: event.clientX, y: event.clientY })
  }
  const size = SPOT / zoom
  const offset = -(SPOT + OUT) / zoom
  const spots = CORNERS.map(({ top, left }) => {
    const icon = !top && !left
    return (
      <div
        key={`${top}-${left}`}
        role={icon ? 'button' : undefined}
        aria-label={icon ? 'Rotate' : undefined}
        title={icon ? 'Rotate (Shift: 15° steps)' : undefined}
        className="nodrag nopan text-muted-foreground hover:text-foreground absolute flex items-center justify-center"
        style={{
          width: size,
          height: size,
          [top ? 'top' : 'bottom']: offset,
          [left ? 'left' : 'right']: offset,
          cursor: CURSOR,
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          start.current = { angle: angleOf(event), rotation }
          setPointer({ x: event.clientX, y: event.clientY })
        }}
        onPointerMove={(event) => {
          if (!start.current) return
          const { angle, rotation: from } = start.current
          updateNodeData(id, { rotation: turnBy(from, angle, angleOf(event), event.shiftKey) })
          setPointer({ x: event.clientX, y: event.clientY })
        }}
        onPointerUp={(event) => {
          start.current = null
          setPointer(null)
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
      >
        {icon && <RotateCw style={{ width: 12 / zoom, height: 12 / zoom }} />}
      </div>
    )
  })
  return (
    <>
      {spots}
      {pointer &&
        createPortal(
          // By the pointer, where the eye already is: it never covers the element's text.
          <div
            className={cn(
              'pointer-events-none fixed z-50 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums shadow-sm',
              onMagnet(rotation)
                ? 'bg-primary text-primary-foreground'
                : 'bg-foreground text-background',
            )}
            style={{ left: pointer.x + 16, top: pointer.y + 16 }}
          >
            {degreesLabel(rotation)}
          </div>,
          document.body,
        )}
    </>
  )
}
