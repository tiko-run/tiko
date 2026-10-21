import { useLayoutEffect, useRef, type RefObject } from 'react'

const MOVE_MS = 150
const NEW_MS = 1200

/**
 * Rows marked `data-flip="<id>"` glide to their new place when the data reorders them, and a
 * row that was not there before fades in with a short accent; a changed view only jumps.
 */
export function useFlip(container: RefObject<HTMLElement | null>, data: unknown, view: string) {
  const last = useRef<{ data: unknown; view: string; tops: Map<string, number> } | null>(null)
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const before = last.current
    const animate =
      before !== null &&
      before.data !== data &&
      before.view === view &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const tops = new Map<string, number>()
    for (const row of root.querySelectorAll<HTMLElement>('[data-flip]')) {
      const id = row.dataset.flip ?? ''
      // offsetTop does not change with scrolling, unlike the row's place on screen.
      tops.set(id, row.offsetTop)
      if (!animate || typeof row.animate !== 'function') continue
      const was = before.tops.get(id)
      if (was === undefined) {
        row.animate([{ backgroundColor: 'var(--accent)' }, { backgroundColor: 'transparent' }], {
          duration: NEW_MS,
          easing: 'ease-out',
        })
      } else if (Math.abs(was - row.offsetTop) > 0.5) {
        row.animate(
          [{ transform: `translateY(${was - row.offsetTop}px)` }, { transform: 'none' }],
          { duration: MOVE_MS, easing: 'ease-out' },
        )
      }
    }
    last.current = { data, view, tops }
  })
}
