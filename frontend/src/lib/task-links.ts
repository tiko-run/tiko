import { useSyncExternalStore } from 'react'

export type OpenIn = 'new' | 'same'
const OPEN_IN_KEY = 'tiko.links.open'

function read(): OpenIn {
  try {
    return localStorage.getItem(OPEN_IN_KEY) === 'same' ? 'same' : 'new'
  } catch {
    return 'new'
  }
}

// Read once: a board renders a link per card, and only Settings changes the choice.
let openIn: OpenIn | undefined
const listeners = new Set<() => void>()

/** Where a link to a task in its tracker opens, as set in Preferences. */
export function readOpenIn(): OpenIn {
  return (openIn ??= read())
}

export function writeOpenIn(value: OpenIn) {
  openIn = value
  try {
    localStorage.setItem(OPEN_IN_KEY, value)
  } catch {
    // Private mode or blocked storage: the choice lasts until reload.
  }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const NEW_TAB = { target: '_blank', rel: 'noreferrer' }

/** Link props for a task's page in its tracker; links already on screen follow a new choice. */
export function useTaskLinkProps() {
  return useSyncExternalStore(subscribe, readOpenIn) === 'same' ? {} : NEW_TAB
}
