import { useSyncExternalStore } from 'react'

export const SECTIONS = [
  'profile',
  'security',
  'preferences',
  'tracker',
  'planning',
  'task-source',
  'people',
  'sharing',
  'privacy',
] as const
export type Section = (typeof SECTIONS)[number]

const PARAM = 'settings'

function isSection(value: string | null): value is Section {
  return SECTIONS.includes(value as Section)
}

function fromUrl(): Section | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get(PARAM)
  if (value === null) return null
  // An unknown section still opens the window, on Profile.
  return isSection(value) ? value : 'profile'
}

// The open section, or null when the window is closed; kept in the URL so a reload or a
// shared link opens the same section.
let current: Section | null = fromUrl()
const listeners = new Set<() => void>()

function writeUrl(section: Section | null) {
  const url = new URL(window.location.href)
  if (section) url.searchParams.set(PARAM, section)
  else url.searchParams.delete(PARAM)
  window.history.replaceState(window.history.state, '', url)
}

/** Opens the settings window on a section, or closes it with null. */
export function openSettings(section: Section | null = 'profile') {
  if (current === section) return
  current = section
  writeUrl(section)
  for (const listener of listeners) listener()
}

export function useSettingsSection() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
    () => null,
  )
}
