import { type NodeProps } from '@xyflow/react'
import { Resizer } from '@/canvas/nodes/Resizer'
import { Rotator, turned, useTurnedHandles } from '@/canvas/nodes/Rotator'
import { memo } from 'react'
import { EditableText } from '@/canvas/nodes/EditableText'
import { Handles } from '@/canvas/nodes/Handles'
import { faded, textPx } from '@/canvas/selection-props'
import type { TextNode as TextNodeType } from '@/canvas/types'
import { cn } from '@/lib/utils'
import { useReadOnly } from '@/canvas/readonly'

function TextNodeView({ id, data, selected }: NodeProps<TextNodeType>) {
  const readOnly = useReadOnly()
  useTurnedHandles(id, data.rotation)
  return (
    <div className="relative h-full w-full" style={turned(data.rotation)}>
      <Resizer
        isVisible={selected && !readOnly}
        rotation={data.rotation}
        minWidth={40}
        minHeight={24}
      />
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
        <EditableText
          nodeId={id}
          value={data.text}
          field="text"
          maxLength={5000}
          placeholder="Text"
        />
      </div>
      {/* Last, so the element never covers its turning spots. */}
      <Rotator id={id} rotation={data.rotation} isVisible={selected && !readOnly} />
      <Handles />
    </div>
  )
}

export const TextNode = memo(TextNodeView)
