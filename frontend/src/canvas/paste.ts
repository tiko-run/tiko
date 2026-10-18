import { pastedRefs } from '@/canvas/refs'

/** Clipboard type that says the copy came from tiko; its value is the copy's id. */
export const CLIPBOARD_MARKER = 'application/x-tiko'
const TEXT_LIMIT = 5000

export type PasteAs = 'text' | 'sticky'
const PASTE_AS_KEY = 'tiko.paste.as'

export function readPasteAs(): PasteAs {
  try {
    return localStorage.getItem(PASTE_AS_KEY) === 'sticky' ? 'sticky' : 'text'
  } catch {
    return 'text'
  }
}

export function writePasteAs(value: PasteAs) {
  try {
    localStorage.setItem(PASTE_AS_KEY, value)
  } catch {
    // Private mode or blocked storage: the choice lasts until reload.
  }
}

export type Paste =
  | { kind: 'elements' }
  | { kind: 'refs'; refs: string[]; more: boolean }
  | { kind: 'text'; text: string }

type Clipboard = Pick<DataTransfer, 'getData'>

/**
 * What a paste over the board adds, tried in order: elements copied in tiko,
 * task keys and links, plain text. Other trackers' links join the refs step.
 */
export function classifyPaste(data: Clipboard, copyId: string | null): Paste | null {
  const marker = data.getData(CLIPBOARD_MARKER)
  if (marker && marker === copyId) return { kind: 'elements' }
  const text = data.getData('text/plain')
  if (!text.trim()) return null
  const refs = pastedRefs(text)
  if (refs) return { kind: 'refs', ...refs }
  return { kind: 'text', text: text.slice(0, TEXT_LIMIT) }
}

/** Fields, the search palette and dialogs take the paste themselves. */
export function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.closest('[role="dialog"]') !== null
  )
}
