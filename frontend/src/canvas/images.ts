/** Picture types a board takes; the server reads each for what it is. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const MAX_IMAGE_MB = 25
/** Widths of the copies the server makes; past the widest, the original. */
export const COPY_WIDTHS = [512, 1024, 2048] as const
/** Asked past the widest copy: the server answers with the original, or a GIF's still copy. */
export const PAST_COPIES = 16384
/** A new picture's longer side on the board, so a 4K screenshot does not cover the view. */
export const PLACED_SIDE = 800
const GAP = 24

export const isImageType = (type: string) => (IMAGE_TYPES as readonly string[]).includes(type)

const BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** Some systems hand over a dropped file with no type; its name still tells, and the server reads it for what it is anyway. */
function typed(file: File) {
  if (file.type) return file
  const type = BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? '']
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file
}

/** The files of a paste or a drop that can go on a board, and a reason for the rest. */
export function sortFiles(files: File[]) {
  const pictures: File[] = []
  const refused: string[] = []
  for (const given of files) {
    const file = typed(given)
    if (!isImageType(file.type))
      refused.push(`${file.name || 'File'}: only PNG, JPEG, WebP and GIF`)
    else if (file.size > MAX_IMAGE_MB * 1024 * 1024)
      refused.push(`${file.name || 'Picture'}: over ${MAX_IMAGE_MB} MB`)
    else pictures.push(file)
  }
  return { pictures, refused }
}

/**
 * The copy to load: the narrowest as wide as the picture is on screen, so a 4K screenshot far
 * out costs a thumbnail. Infinity stands for the original.
 */
export function copyWidth(widthOnBoard: number, zoom: number, pixelRatio: number) {
  const needed = widthOnBoard * zoom * pixelRatio
  return COPY_WIDTHS.find((width) => width >= needed) ?? Infinity
}

/** A picture's size on the board when it is added: its own, the longer side at most PLACED_SIDE. */
export function placedSize(width: number, height: number) {
  const scale = Math.min(1, PLACED_SIDE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** `work` over `items`, at most `limit` at a time, results in order. */
export async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await work(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return results
}

/** Pictures side by side, the row centered on `at`; returns each one's top-left corner. */
export function rowAround(
  at: { x: number; y: number },
  sizes: { width: number; height: number }[],
) {
  const total = sizes.reduce((sum, s) => sum + s.width, 0) + GAP * Math.max(0, sizes.length - 1)
  let x = at.x - total / 2
  return sizes.map((size) => {
    const corner = { x, y: at.y - size.height / 2 }
    x += size.width + GAP
    return corner
  })
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')

/** The average colour of RGBA pixels, ignoring see-through ones, as #rrggbb. */
export function averageColor(pixels: Uint8ClampedArray) {
  let r = 0
  let g = 0
  let b = 0
  let weight = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] / 255
    r += pixels[i] * a
    g += pixels[i + 1] * a
    b += pixels[i + 2] * a
    weight += a
  }
  if (weight === 0) return '#808080'
  return `#${hex(r / weight)}${hex(g / weight)}${hex(b / weight)}`
}

const SAMPLE = 16

/** The first frame of a picture that may move. */
async function firstFrame(bitmap: ImageBitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

/** Size and average colour, read before the upload so the element has its shape at once. */
export async function readPicture(file: Blob) {
  // Decoded off the main thread, turned by its EXIF orientation as the server turns it.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const canvas = new OffscreenCanvas(SAMPLE, SAMPLE)
    const context = canvas.getContext('2d')
    context?.drawImage(bitmap, 0, 0, SAMPLE, SAMPLE)
    const pixels = context?.getImageData(0, 0, SAMPLE, SAMPLE).data
    return {
      width: bitmap.width,
      height: bitmap.height,
      color: pixels ? averageColor(pixels) : '#808080',
      // A GIF or WebP may move; its local preview stays still while it uploads.
      still: ['image/gif', 'image/webp'].includes(file.type) ? await firstFrame(bitmap) : undefined,
    }
  } finally {
    bitmap.close()
  }
}
