import { useRef } from 'react'
import { IMAGE_TYPES } from '@/canvas/images'

/** The device's file picker for pictures; `input` goes anywhere in the tree, `open` shows it. */
export function useImagePicker(onFiles: (files: File[]) => void) {
  const ref = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type="file"
      accept={IMAGE_TYPES.join(',')}
      multiple
      // Out of sight rather than `hidden`: some browsers open no picker for an input not rendered.
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-testid="image-picker"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        // Cleared, so picking the same file again still adds it.
        event.target.value = ''
        if (files.length) onFiles(files)
      }}
    />
  )
  return { input, open: () => ref.current?.click() }
}
