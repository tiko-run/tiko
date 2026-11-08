import { createContext, useContext, useSyncExternalStore } from 'react'
import type { FileSource } from '@/api/files'

/** A picture added in this tab: shown from the local copy until the stored one has loaded. */
export type Upload = { local: string; error?: string }
/** What the element looked like when added, so copies of it made meanwhile are found. */
export type Look = { w: number; h: number; color: string }

const PARALLEL = 3

/**
 * Pictures this tab is uploading, by element id. Three at a time, so a paste of ten
 * screenshots does not hold every connection; a failed one waits for its retry.
 */
export class Uploads {
  private items = new Map<string, Upload & { file: Blob; look: Look }>()
  private queue: string[] = []
  private running = 0
  private listeners = new Set<() => void>()
  private send: (file: Blob) => Promise<string>
  private done: (id: string, file: string, look: Look) => void

  constructor(
    send: (file: Blob) => Promise<string>,
    done: (id: string, file: string, look: Look) => void,
  ) {
    this.send = send
    this.done = done
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get = (id: string): Upload | undefined => this.items.get(id)

  /** Elements whose upload failed and waits for its retry. */
  failed = () => [...this.items].filter(([, item]) => item.error).map(([id]) => id)

  add(id: string, file: Blob, look: Look) {
    this.items.set(id, { file, look, local: URL.createObjectURL(file) })
    this.queue.push(id)
    this.changed()
    this.next()
  }

  retry(id: string) {
    const item = this.items.get(id)
    if (!item?.error) return
    this.items.set(id, { ...item, error: undefined })
    this.queue.push(id)
    this.changed()
    this.next()
  }

  /** The stored picture is on screen: the local copy can go. */
  forget(id: string) {
    if (this.items.get(id)?.error) return
    this.drop(id)
  }

  /** The element left the board: its upload, done or not, lets go of the file. */
  drop(id: string) {
    const item = this.items.get(id)
    if (!item) return
    URL.revokeObjectURL(item.local)
    this.items.delete(id)
    this.queue = this.queue.filter((queued) => queued !== id)
    this.changed()
  }

  /** The board closes: nothing it uploads is shown any more. */
  dispose() {
    for (const id of [...this.items.keys()]) this.drop(id)
  }

  private next() {
    while (this.running < PARALLEL && this.queue.length) {
      const id = this.queue.shift()!
      const item = this.items.get(id)
      if (!item) continue
      this.running++
      this.send(item.file)
        .then((file) => {
          if (this.items.has(id)) this.done(id, file, item.look)
        })
        .catch((error: unknown) => {
          // Dropped meanwhile: a late failure must not bring the element's upload back.
          if (!this.items.has(id)) return
          const message = error instanceof Error ? error.message : 'Upload failed'
          this.items.set(id, { ...item, error: message })
          this.changed()
        })
        .finally(() => {
          this.running--
          this.next()
        })
    }
  }

  private changed() {
    // A new object per change, so useSyncExternalStore sees it.
    for (const [id, item] of this.items) this.items.set(id, { ...item })
    for (const listener of this.listeners) listener()
  }
}

export type ImagesHost = { source: FileSource; uploads: Uploads | null }

export const ImagesContext = createContext<ImagesHost | null>(null)

export function useImages() {
  const host = useContext(ImagesContext)
  if (!host) throw new Error('useImages outside ImagesContext')
  return host
}

const none = () => () => {}

/** This tab's upload of the element, if it is one. */
export function useUpload(id: string) {
  const { uploads } = useImages()
  return useSyncExternalStore(uploads?.subscribe ?? none, () => uploads?.get(id))
}
