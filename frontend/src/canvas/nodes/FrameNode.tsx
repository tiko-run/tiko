import { type NodeProps } from '@xyflow/react'
import { Resizer } from '@/canvas/nodes/Resizer'
import { memo } from 'react'
import { EditableText } from '@/canvas/nodes/EditableText'
import { Handles } from '@/canvas/nodes/Handles'
import type { FrameNode as FrameNodeType } from '@/canvas/types'
import { cn } from '@/lib/utils'
import { useReadOnly } from '@/canvas/readonly'

function FrameNodeView({ id, data, selected }: NodeProps<FrameNodeType>) {
  const readOnly = useReadOnly()
  // A tint, not the full color: the elements inside keep their own surfaces readable.
  const tint =
    data.color && data.color !== 'none'
      ? `color-mix(in oklch, var(--sticky-${data.color}) var(--frame-tint), transparent)`
      : undefined
  // Faded below the handles, so a faint frame is still plain to resize.
  const opacity = data.opacity === undefined ? undefined : data.opacity / 100
  // Title sits above the border, like Miro, so it never covers the cards inside.
  return (
    // The selection outline sits outside the faded layer, so a faint frame still shows it is picked.
    <div
      className={cn('relative h-full w-full rounded-md', selected && 'outline-primary outline-1')}
    >
      <div
        className={cn(
          'absolute inset-0 rounded-md border',
          !tint && 'bg-muted/40',
          selected && !tint && 'bg-accent',
        )}
        style={{ background: tint, opacity }}
      />
      <Resizer isVisible={selected && !readOnly} minWidth={160} minHeight={120} />
      <div
        className="absolute bottom-full left-0 mb-1 max-w-full text-[13px] font-medium"
        style={{ opacity }}
      >
        <EditableText
          nodeId={id}
          value={data.title}
          field="title"
          maxLength={200}
          placeholder="Frame"
          singleLine
          className="text-muted-foreground truncate"
        />
      </div>
      <Handles />
    </div>
  )
}

export const FrameNode = memo(FrameNodeView)
