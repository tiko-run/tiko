import { useStoreApi } from '@xyflow/react'
import { useEffect, useSyncExternalStore, type RefObject } from 'react'

export type Wheel = 'scroll' | 'zoom'
const WHEEL_KEY = 'tiko.wheel'

function read(): Wheel {
  try {
    return localStorage.getItem(WHEEL_KEY) === 'zoom' ? 'zoom' : 'scroll'
  } catch {
    return 'scroll'
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

// Same speed as xyflow's pan on scroll.
const PAN_SPEED = 0.5

/** Sideways pixels for Shift + wheel: macOS turns it into deltaX, Windows and Linux keep deltaY. */
export function sidewaysDelta(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>) {
  const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
  // Firefox counts lines, not pixels.
  return delta * (event.deltaMode === 1 ? 20 : 1) * PAN_SPEED
}

/** In zoom mode Shift + wheel pans sideways; xyflow would zoom on it. */
export function useShiftWheelPan(surface: RefObject<HTMLElement | null>, on: boolean) {
  const store = useStoreApi()
  useEffect(() => {
    const element = surface.current
    if (!on || !element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.shiftKey || event.ctrlKey || event.metaKey) return
      if ((event.target as Element).closest('.nowheel')) return
      // Capture on the surface runs before xyflow's listener below it.
      event.preventDefault()
      event.stopPropagation()
      void store.getState().panBy({ x: -sidewaysDelta(event), y: 0 })
    }
    element.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => element.removeEventListener('wheel', onWheel, { capture: true })
  }, [surface, on, store])
}
