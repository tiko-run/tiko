import { NodeResizer, type NodeProps } from '@xyflow/react'
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
  // Title sits above the border, like Miro, so it never covers the cards inside.
  return (
    <div
      className={cn(
        'relative h-full w-full rounded-md border',
        !tint && 'bg-muted/40',
        selected && 'border-primary',
        selected && !tint && 'bg-accent',
      )}
      style={{ background: tint }}
    >
      <NodeResizer isVisible={selected && !readOnly} minWidth={160} minHeight={120} />
      <div className="absolute bottom-full left-0 mb-1 max-w-full text-[13px] font-medium">
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
