import { useStore, type NodeProps } from '@xyflow/react'
import { ImageOff, ImagePlus, RotateCcw } from 'lucide-react'
import { memo, useEffect, useState, type ReactNode } from 'react'
import { fileUrl } from '@/api/files'
import { useReducedMotion } from '@/lib/motion'
import { useImagePicker } from '@/canvas/ImagePicker'
import { copyWidth, PAST_COPIES } from '@/canvas/images'
import { Handles } from '@/canvas/nodes/Handles'
import { Resizer } from '@/canvas/nodes/Resizer'
import { Rotator, turned, useTurnedHandles } from '@/canvas/nodes/Rotator'
import { useReadOnly } from '@/canvas/readonly'
import type { ImageNode as ImageNodeType } from '@/canvas/types'
import { useImages, useUpload } from '@/canvas/uploads'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const pixelRatio = () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
// A copy that failed to load is asked again this many times, a little later each time.
const RETRIES = 3
const RETRY_MS = 2000
// A copy this many times sharper than the screen needs gives way to a smaller one.
const STEP_DOWN = 4
// A moving picture plays only this wide on screen and up; smaller, its first frame shows.
const PLAY_PX = 80
// An upload not stored after this long is taken as one that never finished.
const STALE_MS = 2 * 60 * 1000

/** Whether an element still waiting for its file has waited too long. */
function useStale(waiting: boolean, since: string | undefined) {
  const due = since ? Date.parse(since) + STALE_MS : 0
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!waiting || now >= due) return
    // From the clock, not from `now`: a retry moves `due` past a `now` taken long ago.
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, due - Date.now()))
    return () => clearTimeout(timer)
  }, [waiting, due, now])
  return waiting && now >= due
}

function ImageNodeView({ id, data, selected, width }: NodeProps<ImageNodeType>) {
  const readOnly = useReadOnly()
  const { source, uploads, again } = useImages()
  const upload = useUpload(id)
  const onBoard = width ?? data.w
  // Numbers and flags, so only a step to another copy redraws the element, not every zoom tick.
  const wanted = useStore((state) => copyWidth(onBoard, state.transform[2], pixelRatio()))
  const large = useStore((state) => onBoard * state.transform[2] >= PLAY_PX)
  const calm = useReducedMotion()
  const playing = Boolean(data.moving) && large && !calm
  // Zooming out a little keeps the sharper copy already loaded; far out, a smaller one takes
  // its place, so a board of big pictures does not hold every original in memory.
  const [loadedWidth, setLoadedWidth] = useState(0)
  const step = wanted * STEP_DOWN <= loadedWidth ? wanted : Math.max(loadedWidth, wanted)
  const local = upload?.local
  const stale = useStale(!data.file && !local, data.since)
  const picker = useImagePicker((files) => again?.(id, files[0]))
  // The last copy that loaded stays under the next one until that one has loaded too.
  const [shown, setShown] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ src: string; count: number } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useTurnedHandles(id, data.rotation)

  // Past the widest copy the server answers with the original, or a still copy for a GIF.
  const src = data.file
    ? fileUrl(source, data.file, Number.isFinite(step) ? step : PAST_COPIES, playing)
    : null
  const failing = src !== null && failure?.src === src ? failure.count : 0
  const broken = failing > RETRIES
  useEffect(() => {
    if (failing === 0 || failing > RETRIES) return
    const timer = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS * failing)
    return () => clearTimeout(timer)
  }, [failing])

  return (
    <div className="relative h-full w-full" style={turned(data.rotation)}>
      <Resizer
        isVisible={selected && !readOnly}
        rotation={data.rotation}
        keepAspectRatio
        minWidth={24}
        minHeight={24}
      />
      <div
        className={cn('relative h-full w-full overflow-hidden', selected && 'ring-primary ring-2')}
        // The tone only holds the place: a transparent picture shows the board through it.
        style={{ background: shown || local ? undefined : data.color }}
      >
        {local && !shown && <Picture src={local} />}
        {shown && shown !== src && <Picture src={shown} />}
        {src && !broken && (
          <Picture
            key={`${src}#${attempt}`}
            src={src}
            hidden={shown !== src}
            onLoad={() => {
              setShown(src)
              if (!playing) setLoadedWidth(step)
              uploads?.forget(id)
            }}
            onError={() =>
              setFailure((was) => ({ src, count: was?.src === src ? was.count + 1 : 1 }))
            }
          />
        )}
        {!data.file && !local && !stale && <Note>Uploading…</Note>}
        {stale && (
          <Note>
            Upload did not finish
            {!readOnly && again && (
              <>
                {picker.input}
                <Button size="sm" variant="secondary" className="nodrag" onClick={picker.open}>
                  <ImagePlus aria-hidden />
                  Pick the file again
                </Button>
              </>
            )}
          </Note>
        )}
        {broken && (
          <Note>
            <ImageOff className="size-5" aria-hidden />
            Image not available
            <Button
              size="sm"
              variant="secondary"
              className="nodrag"
              onClick={() => {
                setFailure(null)
                setAttempt((n) => n + 1)
              }}
            >
              <RotateCcw aria-hidden />
              Try again
            </Button>
          </Note>
        )}
        {upload?.error && (
          <Note>
            <span>{upload.error}</span>
            <Button
              size="sm"
              variant="secondary"
              className="nodrag"
              onClick={() => uploads?.retry(id)}
            >
              <RotateCcw aria-hidden />
              Retry
            </Button>
          </Note>
        )}
      </div>
      <Rotator id={id} rotation={data.rotation} isVisible={selected && !readOnly} />
      <Handles />
    </div>
  )
}

function Picture({
  src,
  hidden,
  onLoad,
  onError,
}: {
  src: string
  hidden?: boolean
  onLoad?: () => void
  onError?: () => void
}) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      decoding="async"
      className={cn('absolute inset-0 size-full', hidden && 'opacity-0')}
      onLoad={onLoad}
      onError={onError}
    />
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background/80 text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 text-center text-xs">
      {children}
    </div>
  )
}

export const ImageNode = memo(ImageNodeView)
