import { useStoreApi } from '@xyflow/react'
import { useEffect, useSyncExternalStore } from 'react'

export type Wheel = 'auto' | 'scroll' | 'zoom'
const WHEEL_KEY = 'tiko.wheel'

function read(): Wheel {
  try {
    const stored = localStorage.getItem(WHEEL_KEY)
    return stored === 'scroll' || stored === 'zoom' ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

let wheel: Wheel | undefined
const listeners = new Set<() => void>()

/** What the mouse wheel does on the board, as set in Preferences. */
export function readWheel(): Wheel {
  return (wheel ??= read())
}

export function writeWheel(value: Wheel) {
  wheel = value
  try {
    localStorage.setItem(WHEEL_KEY, value)
  } catch {
    // Private mode or blocked storage: the choice lasts until reload.
  }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useWheel = () => useSyncExternalStore(subscribe, readWheel)

type Delta = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'> & { wheelDeltaY?: number }

/**
 * A mouse wheel rather than a trackpad swipe. Firefox counts a mouse in lines; Chrome and Safari
 * give a trackpad a legacy wheelDeltaY of exactly -3 × deltaY and a mouse notches of 120.
 * Mice with free-spinning or touch wheels pass as trackpads; Preferences can force Zoom for them.
 */
export function isMouseWheel(event: Delta) {
  if (event.deltaMode !== 0) return true
  if (event.deltaX !== 0) return false
  const legacy = event.wheelDeltaY
  if (legacy) return Math.abs(legacy + 3 * event.deltaY) > 1
  return Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= 50
}

// Same speeds as xyflow: its pan on scroll and d3-zoom's wheel.
const PAN_SPEED = 0.5
const zoomFactor = (event: Delta) =>
  2 ** (-event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002))

/** Sideways pixels for Shift + wheel: macOS turns it into deltaX, Windows and Linux keep deltaY. */
export function sidewaysDelta(event: Delta) {
  const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
  // Firefox counts lines, not pixels.
  return delta * (event.deltaMode === 1 ? 20 : 1) * PAN_SPEED
}

/** What this tiko code does with a wheel event before xyflow sees it; null leaves it to xyflow. */
export function wheelAction(
  event: Delta & Pick<WheelEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>,
  mode: Wheel,
) {
  // Ctrl, Cmd and a pinch (ctrlKey on macOS) already zoom in xyflow.
  if (event.ctrlKey || event.metaKey) return null
  if (mode === 'zoom') return event.shiftKey ? 'sideways' : null
  if (mode === 'auto' && !event.shiftKey && isMouseWheel(event)) return 'zoom'
  return null
}

/**
 * The wheel modes over xyflow: Zoom turns off its pan on scroll and pans on Shift here,
 * Auto keeps it for trackpads and zooms here on a mouse wheel.
 */
export function useWheelMode(element: HTMLElement | null, mode: Wheel) {
  const store = useStoreApi()
  useEffect(() => {
    if (mode === 'scroll' || !element) return
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('.nowheel')) return
      const action = wheelAction(event, mode)
      if (!action) return
      // Capture on the surface runs before xyflow's listener below it.
      event.preventDefault()
      event.stopPropagation()
      const state = store.getState()
      if (action === 'sideways') {
        void state.panBy({ x: -sidewaysDelta(event), y: 0 })
        return
      }
      const [x, y, k] = state.transform
      const zoom = Math.min(state.maxZoom, Math.max(state.minZoom, k * zoomFactor(event)))
      const box = state.domNode?.getBoundingClientRect()
      const px = event.clientX - (box?.left ?? 0)
      const py = event.clientY - (box?.top ?? 0)
      void state.panZoom?.setViewport({
        x: px - ((px - x) * zoom) / k,
        y: py - ((py - y) * zoom) / k,
        zoom,
      })
    }
    element.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => element.removeEventListener('wheel', onWheel, { capture: true })
  }, [element, mode, store])
}
