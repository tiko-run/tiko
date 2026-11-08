import { useStore, type NodeProps } from '@xyflow/react'
import { ImageOff, RotateCcw } from 'lucide-react'
import { memo, useEffect, useState, type ReactNode } from 'react'
import { fileUrl } from '@/api/files'
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

function ImageNodeView({ id, data, selected, width }: NodeProps<ImageNodeType>) {
  const readOnly = useReadOnly()
  const { source, uploads } = useImages()
  const upload = useUpload(id)
  const onBoard = width ?? data.w
  // A number, so only a step to another copy redraws the element, not every zoom tick.
  const wanted = useStore((state) => copyWidth(onBoard, state.transform[2], pixelRatio()))
  // Zooming back out keeps the sharper copy already loaded instead of fetching a smaller one.
  const [loadedWidth, setLoadedWidth] = useState(0)
  const step = Math.max(loadedWidth, wanted)
  // The last copy that loaded stays under the next one until that one has loaded too.
  const [shown, setShown] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ src: string; count: number } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useTurnedHandles(id, data.rotation)

  // Past the widest copy the server answers with the original, or a still copy for a GIF.
  const src = data.file
    ? fileUrl(source, data.file, Number.isFinite(step) ? step : PAST_COPIES)
    : null
  const local = upload?.local
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
        style={{ background: data.color }}
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
              setLoadedWidth(step)
              uploads?.forget(id)
            }}
            onError={() =>
              setFailure((was) => ({ src, count: was?.src === src ? was.count + 1 : 1 }))
            }
          />
        )}
        {!data.file && !local && <Note>Uploading…</Note>}
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
