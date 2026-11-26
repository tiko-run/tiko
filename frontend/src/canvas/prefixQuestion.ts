import { useSyncExternalStore } from 'react'

/** A bare key whose prefix two of the person's trackers know. */
export type PrefixQuestion = {
  prefix: string
  /** The first key with the prefix, named in the question. */
  key: string
  sources: string[]
}

export type PrefixAnswer = { source: string; remember: boolean }

type Asked = PrefixQuestion & { answer: (choice: PrefixAnswer | null) => void }

// One question on screen at a time; the others wait their turn, as from a second paste.
let waiting: Asked[] = []
let asked: Asked | null = null
const listeners = new Set<() => void>()

function show() {
  asked = waiting[0] ?? null
  listeners.forEach((listener) => listener())
}

/** Asks the person where the key is from; null when they cancel or nothing can ask. */
export function askPrefix(question: PrefixQuestion): Promise<PrefixAnswer | null> {
  if (listeners.size === 0) return Promise.resolve(null)
  return new Promise((resolve) => {
    const entry: Asked = {
      ...question,
      answer: (choice) => {
        waiting = waiting.filter((other) => other !== entry)
        show()
        resolve(choice)
      },
    }
    waiting = [...waiting, entry]
    if (!asked) show()
  })
}

export function usePrefixQuestion() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => asked,
  )
}

/** Keeps a popover with the card form open while the dialog asks: the dialog sits outside it. */
export function keepOpenWhileAsking(event: Event) {
  if (asked) event.preventDefault()
}
