import { NodeResizer, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { EditableText } from '@/canvas/nodes/EditableText'
import { Handles } from '@/canvas/nodes/Handles'
import { faded, textPx } from '@/canvas/selection-props'
import type { TextNode as TextNodeType } from '@/canvas/types'
import { cn } from '@/lib/utils'
import { useReadOnly } from '@/canvas/readonly'

function TextNodeView({ id, data, selected }: NodeProps<TextNodeType>) {
  const readOnly = useReadOnly()
  return (
    <div
      className={cn(
        'h-full w-full rounded-sm px-1 leading-[1.35]',
        selected && 'outline-primary outline-1',
      )}
      style={{
        fontSize: textPx('text', data.size),
        fontWeight: data.bold ? 600 : undefined,
        color: data.opacity === undefined ? undefined : faded('var(--foreground)', data.opacity),
      }}
    >
      <NodeResizer isVisible={selected && !readOnly} minWidth={40} minHeight={24} />
      <EditableText
        nodeId={id}
        value={data.text}
        field="text"
        maxLength={5000}
        placeholder="Text"
      />
      <Handles />
    </div>
  )
}

export const TextNode = memo(TextNodeView)
