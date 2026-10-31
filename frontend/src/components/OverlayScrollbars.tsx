import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  /** The scroller; give it `no-scrollbar` so its own bars do not show. */
  target: HTMLElement | null
  /** Where the sideways bar starts, past columns that do not scroll. */
  insetLeft?: number
}

type Metrics = {
  left: number
  top: number
  scrollWidth: number
  scrollHeight: number
  width: number
  height: number
}

const HIDE_MS = 1000
const MIN_THUMB = 24
const EDGE = 2

/** Thin bars over the content that show while it scrolls and fade when it rests. */
export function OverlayScrollbars({ target, insetLeft = 0 }: Props) {
  const [m, setM] = useState<Metrics | null>(null)
  const [shown, setShown] = useState(false)
  const [held, setHeld] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!target) return
    const read = () =>
      setM({
        left: target.scrollLeft,
        top: target.scrollTop,
        scrollWidth: target.scrollWidth,
        scrollHeight: target.scrollHeight,
        width: target.clientWidth,
        height: target.clientHeight,
      })
    const onScroll = () => {
      read()
      setShown(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setShown(false), HIDE_MS)
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(target)
    for (const child of target.children) observer.observe(child)
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      target.removeEventListener('scroll', onScroll)
      window.clearTimeout(timer.current)
    }
  }, [target])

  if (!target || !m) return null
  const visible = shown || held
  return (
    <>
      {m.scrollWidth > m.width + 1 && (
        <Bar
          axis="x"
          track={m.width - insetLeft - EDGE * 2}
          // The fixed columns are not part of what scrolls.
          size={m.width - insetLeft}
          content={m.scrollWidth - insetLeft}
          offset={m.left}
          visible={visible}
          style={{ left: insetLeft + EDGE, right: EDGE, bottom: EDGE }}
          onHold={setHeld}
          onScroll={(to) => (target.scrollLeft = to)}
        />
      )}
      {m.scrollHeight > m.height + 1 && (
        <Bar
          axis="y"
          track={m.height - EDGE * 2}
          size={m.height}
          content={m.scrollHeight}
          offset={m.top}
          visible={visible}
          style={{ top: EDGE, bottom: EDGE, right: EDGE }}
          onHold={setHeld}
          onScroll={(to) => (target.scrollTop = to)}
        />
      )}
    </>
  )
}

function Bar({
  axis,
  track,
  size,
  content,
  offset,
  visible,
  style,
  onHold,
  onScroll,
}: {
  axis: 'x' | 'y'
  track: number
  size: number
  content: number
  offset: number
  visible: boolean
  style: CSSProperties
  onHold: (held: boolean) => void
  onScroll: (to: number) => void
}) {
  const drag = useRef<{ from: number; offset: number } | null>(null)
  const thumb = Math.max((track * size) / content, MIN_THUMB)
  const range = content - size
  const at = range > 0 ? ((track - thumb) * offset) / range : 0
  const pos = (event: PointerEvent) => (axis === 'x' ? event.clientX : event.clientY)
  const release = () => {
    drag.current = null
    onHold(false)
  }
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute z-50 transition-opacity duration-200',
        axis === 'x' ? 'h-1.5' : 'w-1.5',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={style}
    >
      <div
        className={cn(
          'bg-muted-foreground/35 hover:bg-muted-foreground/60 absolute rounded-full',
          axis === 'x' ? 'inset-y-0' : 'inset-x-0',
          visible && 'pointer-events-auto',
        )}
        style={axis === 'x' ? { left: at, width: thumb } : { top: at, height: thumb }}
        onPointerEnter={() => onHold(true)}
        onPointerLeave={() => !drag.current && onHold(false)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { from: pos(event), offset }
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start || track <= thumb) return
          onScroll(start.offset + ((pos(event) - start.from) * range) / (track - thumb))
        }}
        onPointerUp={release}
        onPointerCancel={release}
      />
    </div>
  )
}
