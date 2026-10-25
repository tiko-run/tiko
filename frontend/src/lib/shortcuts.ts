import { useLayoutEffect, useRef } from 'react'
import { useHotkeys, type HotkeyCallback, type Options } from 'react-hotkeys-hook'

type Shortcut = {
  /** react-hotkeys-hook syntax; a comma separates alternatives, `mod` is Cmd on macOS and Ctrl elsewhere. */
  keys: string
  label: string
  group: 'General' | 'Tools' | 'Edit' | 'Canvas'
  /** Shown instead of the keys when they read badly, like shift+slash for "?". */
  display?: string
}

/** Every keyboard shortcut in one place: the help dialog lists them and tooltips show them. */
export const SHORTCUTS = {
  help: { keys: 'shift+slash', display: '?', label: 'Keyboard shortcuts', group: 'General' },
  search: { keys: 'mod+k, mod+f', label: 'Search the board', group: 'General' },
  commands: { keys: 'mod+p, mod+shift+p', label: 'Commands', group: 'General' },
  settings: { keys: 'mod+comma', label: 'Settings', group: 'General' },
  // On Home, where no board takes the search keys.
  findBoard: {
    keys: 'slash, mod+k',
    display: '/',
    label: 'Find a board on Home',
    group: 'General',
  },
  // Handled by the search palette; listed so the help dialog and the palette show it.
  selectMatches: { keys: 'mod+enter', label: 'Select all search results', group: 'General' },
  select: { keys: 'v', label: 'Select', group: 'Tools' },
  hand: { keys: 'h', label: 'Hand', group: 'Tools' },
  frame: { keys: 'f', label: 'Frame', group: 'Tools' },
  sticky: { keys: 'n', label: 'Sticky note', group: 'Tools' },
  text: { keys: 't', label: 'Text', group: 'Tools' },
  shape: { keys: 's', label: 'Shapes', group: 'Tools' },
  timer: { keys: 'r', label: 'Timer', group: 'Tools' },
  card: { keys: 'c', label: 'Task card', group: 'Tools' },
  module: { keys: 'm', label: 'Modules', group: 'Tools' },
  cancel: { keys: 'escape', label: 'Back to Select', group: 'Tools' },
  undo: { keys: 'mod+z', label: 'Undo', group: 'Edit' },
  redo: { keys: 'mod+shift+z, ctrl+y', label: 'Redo', group: 'Edit' },
  copy: { keys: 'mod+c', label: 'Copy', group: 'Edit' },
  cut: { keys: 'mod+x', label: 'Cut', group: 'Edit' },
  paste: { keys: 'mod+v', label: 'Paste at the cursor', group: 'Edit' },
  duplicate: { keys: 'mod+d', label: 'Duplicate', group: 'Edit' },
  selectAll: { keys: 'mod+a', label: 'Select all', group: 'Edit' },
  // Handled by the canvas library; listed so the help dialog is complete.
  remove: { keys: 'delete, backspace', label: 'Delete selection', group: 'Edit' },
  addToSelection: {
    keys: 'shift',
    display: 'Shift + click',
    label: 'Add to selection',
    group: 'Edit',
  },
  back: { keys: 'b', label: 'Back to where you were', group: 'Canvas' },
  pan: { keys: 'space', display: 'Space + drag', label: 'Pan', group: 'Canvas' },
  freeDrag: {
    keys: 'alt',
    display: 'Alt + drag',
    label: 'Move without snapping',
    group: 'Canvas',
  },
} satisfies Record<string, Shortcut>

export type ShortcutId = keyof typeof SHORTCUTS

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

const KEY_NAMES: Record<string, string> = {
  mod: isMac ? '⌘' : 'Ctrl',
  ctrl: isMac ? '⌃' : 'Ctrl',
  shift: 'Shift',
  alt: isMac ? '⌥' : 'Alt',
  escape: 'Esc',
  comma: ',',
  enter: '↵',
  delete: 'Delete',
  backspace: 'Backspace',
  space: 'Space',
}

/** Human-readable alternatives, each a list of keys: "mod+d" → [["⌘", "D"]]. */
export function formatShortcut(id: ShortcutId): string[][] {
  const shortcut: Shortcut = SHORTCUTS[id]
  if (shortcut.display) return [[shortcut.display]]
  return shortcut.keys.split(',').map((combo) =>
    combo
      .trim()
      .split('+')
      .map((key) => KEY_NAMES[key] ?? key.toUpperCase()),
  )
}

/** Tooltip text like "Frame (F)". */
export function withShortcut(id: ShortcutId) {
  return `${SHORTCUTS[id].label} (${formatShortcut(id)[0].join('+')})`
}

// Board shortcuts must not act on the canvas hidden behind Settings or another dialog.
const dialogOpen = () =>
  document.querySelector('[data-slot="dialog-content"], [data-slot="sheet-content"]') !== null

/** For undo and redo: an expanded module edits the board, so its view lets them through. */
export const dialogOverBoard = () =>
  document.querySelector(
    '[data-slot="dialog-content"]:not([data-module-expanded]), [data-slot="sheet-content"]',
  ) !== null

/** Binds a shortcut from the registry; ignored while typing in inputs or with a dialog open. */
export function useShortcut(id: ShortcutId, handler: HotkeyCallback, options?: Options) {
  // The library memoizes the callback; a ref keeps the latest one without dependency lists.
  const latest = useRef(handler)
  useLayoutEffect(() => {
    latest.current = handler
  })
  return useHotkeys(SHORTCUTS[id].keys, (...args) => latest.current(...args), {
    preventDefault: true,
    ignoreEventWhen: dialogOpen,
    ...options,
  })
}
