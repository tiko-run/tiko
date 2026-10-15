import { useSyncExternalStore } from 'react'
import { didOnboarding } from '@/onboarding/done'

// Shared by the board's timer button and the main menu, which live in different trees.
let open = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setTimerPanelOpen(next: boolean) {
  if (open === next) return
  open = next
  if (open) didOnboarding('timer_list')
  for (const listener of listeners) listener()
}

export function useTimerPanelOpen() {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}
