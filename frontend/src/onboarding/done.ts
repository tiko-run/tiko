import { useSyncExternalStore } from 'react'
import type { Item } from '@/api/onboarding'

// Getting started items tick from wherever the action happens, with no import of the list.
const DONE = 'tiko:onboarding-done'

export function didOnboarding(item: Item) {
  window.dispatchEvent(new CustomEvent<Item>(DONE, { detail: item }))
}

export function onOnboardingDone(listener: (item: Item) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<Item>).detail)
  window.addEventListener(DONE, handler)
  return () => window.removeEventListener(DONE, handler)
}

// Shared by the list and About, which live in different trees.
let open = false
const listeners = new Set<() => void>()

export function setChecklistOpen(next: boolean) {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}

export function useChecklistOpen() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => open,
    () => false,
  )
}
