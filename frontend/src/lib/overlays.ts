import { useSyncExternalStore } from 'react'

// Panels pinned to the top of the window register here, so the selection bar keeps clear of
// whichever are shown, at their real size, rather than of a guessed strip.
const shown = new Set<Element>()
const listeners = new Set<() => void>()
let version = 0
let observer: ResizeObserver | null = null

function changed() {
  version += 1
  for (const listener of listeners) listener()
}

/** A ref for a panel pinned to the top of the window. */
export function topOverlay(el: Element | null) {
  if (!el) return
  observer ??= new ResizeObserver(changed)
  shown.add(el)
  observer.observe(el)
  changed()
  return () => {
    shown.delete(el)
    observer?.unobserve(el)
    changed()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Changes whenever a top panel appears, goes or resizes. */
export const useTopOverlays = () => useSyncExternalStore(subscribe, () => version)

/** The top panels on screen, relative to an element's box. */
export function topOverlayRects(origin: Element) {
  const at = origin.getBoundingClientRect()
  return [...shown]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ left: r.left - at.left, right: r.right - at.left, bottom: r.bottom - at.top }))
}
