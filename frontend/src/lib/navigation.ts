import { useSyncExternalStore } from 'react'

const NAVIGATED = 'tiko:navigate'

/** The board named in the address, or null for Home. */
function readBoard(): string | null {
  return new URLSearchParams(window.location.search).get('board')
}

function readRename(): boolean {
  return new URLSearchParams(window.location.search).has('rename')
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATED, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATED, onChange)
  }
}

/** The board in the address, kept in step with Back and Forward; null on Home and in prerender. */
export function useAddressBoard(): string | null {
  return useSyncExternalStore(subscribe, readBoard, () => null)
}

/** Whether the board was just made and its name should open for typing. */
export function useRenameOnOpen(): boolean {
  return useSyncExternalStore(subscribe, readRename, () => false)
}

type Options = {
  /** A redirect, such as a board that is gone, takes the place of the current entry. */
  replace?: boolean
  rename?: boolean
}

/** Opens a board, or Home with null, as a new history entry so Back returns. */
export function goTo(board: string | null, { replace = false, rename = false }: Options = {}) {
  const url = new URL(window.location.href)
  if (board) url.searchParams.set('board', board)
  else url.searchParams.delete('board')
  if (rename) url.searchParams.set('rename', '1')
  else url.searchParams.delete('rename')
  if (url.href === window.location.href) return
  if (replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
  window.dispatchEvent(new Event(NAVIGATED))
}

/** Drops the one-time rename mark from the address once the name field has opened. */
export function clearRename() {
  if (!readRename()) return
  const url = new URL(window.location.href)
  url.searchParams.delete('rename')
  window.history.replaceState(window.history.state, '', url)
  window.dispatchEvent(new Event(NAVIGATED))
}

/** The address of a board, for links that open it in a new tab. */
export function boardHref(board: string): string {
  return `/?board=${encodeURIComponent(board)}`
}

let firstBoard = false

/** "Try the demo" lands on the visitor's welcome board, with Home one step back. */
export function openFirstBoard() {
  firstBoard = true
}

export function takeFirstBoard(): boolean {
  const wanted = firstBoard
  firstBoard = false
  return wanted
}
