import { useSyncExternalStore } from 'react'

/** A true or false shared by parts of the page that live in different React trees. */
export function sharedFlag(onSet?: (value: boolean) => void) {
  let value = false
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    set(next: boolean) {
      if (value === next) return
      value = next
      onSet?.(next)
      for (const listener of listeners) listener()
    },
    use: () =>
      useSyncExternalStore(
        subscribe,
        () => value,
        () => false,
      ),
  }
}
