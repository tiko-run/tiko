import { useSyncExternalStore } from 'react'

const REDUCED = '(prefers-reduced-motion: reduce)'
const subscribe = (change: () => void) => {
  const query = window.matchMedia?.(REDUCED)
  query?.addEventListener('change', change)
  return () => query?.removeEventListener('change', change)
}

/** Follows the system setting, so a GIF stops the moment someone asks for less motion. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(REDUCED).matches ?? false)
}
