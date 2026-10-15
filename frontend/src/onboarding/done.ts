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
