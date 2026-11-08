import { createContext, useContext, useSyncExternalStore } from 'react'
import type { FileSource } from '@/api/files'

/** A picture added in this tab: shown from the local copy until the stored one has loaded. */
export type Upload = { local: string; error?: string }

const PARALLEL = 3

/**
 * Pictures this tab is uploading, by element id. Three at a time, so a paste of ten
 * screenshots does not hold every connection; a failed one waits for its retry.
 */
export class Uploads {
  private items = new Map<string, Upload & { file: Blob }>()
  private queue: string[] = []
  private running = 0
  private listeners = new Set<() => void>()
  private send: (file: Blob) => Promise<string>
  private done: (id: string, file: string) => void

  constructor(send: (file: Blob) => Promise<string>, done: (id: string, file: string) => void) {
    this.send = send
    this.done = done
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get = (id: string): Upload | undefined => this.items.get(id)

  add(id: string, file: Blob) {
    this.items.set(id, { file, local: URL.createObjectURL(file) })
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
    const item = this.items.get(id)
    if (!item || item.error) return
    URL.revokeObjectURL(item.local)
    this.items.delete(id)
    this.changed()
  }

  private next() {
    while (this.running < PARALLEL && this.queue.length) {
      const id = this.queue.shift()!
      const item = this.items.get(id)
      if (!item) continue
      this.running++
      this.send(item.file)
        .then((file) => this.done(id, file))
        .catch((error: unknown) => {
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
