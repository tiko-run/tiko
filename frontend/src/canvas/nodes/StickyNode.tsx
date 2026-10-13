import { NodeResizer, type NodeProps } from '@xyflow/react'
import { Ban } from 'lucide-react'
import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { fitFontSize, STICKY_FONT, STICKY_MAX_CHARS, wouldExceed } from '@/canvas/fit'
import { EditableText } from '@/canvas/nodes/EditableText'
import { Handles } from '@/canvas/nodes/Handles'
import type { StickyNode as StickyNodeType } from '@/canvas/types'
import { cn } from '@/lib/utils'
import { useReadOnly } from '@/canvas/readonly'

const TEXT = 'sticky-text'

function StickyNodeView({ id, data, selected, width, height }: NodeProps<StickyNodeType>) {
  const readOnly = useReadOnly()
  const box = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState(STICKY_FONT)
  // Bumped on every blocked edit so the sign's animation restarts.
  const [blocked, setBlocked] = useState(0)

  // Measured on the live element, shown or edited, so the text never leaves the note.
  const fit = useCallback(() => {
    const root = box.current
    const text = root?.querySelector<HTMLElement>(`.${TEXT}`)
    if (!root || !text) return
    const size = fitFontSize((candidate) => {
      root.style.fontSize = `${candidate}px`
      return text.scrollHeight <= text.clientHeight + 1
    })
    root.style.fontSize = `${size}px`
    setFontSize(size)
  }, [])

  useLayoutEffect(fit, [fit, data.text, width, height])

  const block = () => setBlocked((n) => n + 1)

  return (
    <div
      ref={box}
      className={cn(
        'relative h-full w-full rounded-md p-3 leading-[1.35]',
        selected && 'ring-primary ring-2',
      )}
      style={{
        background: `var(--sticky-${data.color})`,
        color: 'var(--sticky-foreground)',
        fontSize,
      }}
      onInput={fit}
      onFocus={fit}
      onBeforeInput={(event) => {
        const field = event.target
        const added = (event.nativeEvent as InputEvent).data?.length ?? 1
        if (field instanceof HTMLTextAreaElement && wouldExceed(field, added)) block()
      }}
      onPaste={(event) => {
        const field = event.target
        const added = event.clipboardData.getData('text/plain').length
        if (field instanceof HTMLTextAreaElement && wouldExceed(field, added)) block()
      }}
    >
      <NodeResizer isVisible={selected && !readOnly} minWidth={80} minHeight={60} />
      <EditableText
        nodeId={id}
        value={data.text}
        field="text"
        maxLength={STICKY_MAX_CHARS}
        placeholder="Note"
        className={cn(TEXT, 'h-full overflow-hidden')}
      />
      {blocked > 0 && (
        <Ban
          key={blocked}
          aria-hidden
          className="sticky-blocked pointer-events-none absolute inset-0 m-auto size-3/5"
        />
      )}
      <Handles />
    </div>
  )
}

export const StickyNode = memo(StickyNodeView)
