import { NodeResizer, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { EditableText } from '@/canvas/nodes/EditableText'
import { Handles } from '@/canvas/nodes/Handles'
import { SHAPE_MAX_CHARS, SHAPE_MIN, shapePath, sideInset, textInset } from '@/canvas/shapes'
import { fillCss } from '@/canvas/selection-props'
import type { ShapeNode as ShapeNodeType } from '@/canvas/types'
import { cn } from '@/lib/utils'
import { useReadOnly } from '@/canvas/readonly'

function ShapeNodeView({ id, data, selected, width = 0, height = 0 }: NodeProps<ShapeNodeType>) {
  const readOnly = useReadOnly()

  return (
    <div
      className={cn('relative h-full w-full', selected && 'outline-primary outline-1')}
      // The outline and the text share one color, dark on a filled shape in both themes.
      style={{
        color:
          data.color === 'none' || data.color === 'surface'
            ? undefined
            : 'var(--sticky-foreground)',
      }}
    >
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={SHAPE_MIN.width}
        minHeight={SHAPE_MIN.height}
      />
      <svg aria-hidden className="absolute inset-0 size-full overflow-visible">
        <path
          d={shapePath(data.shape, width, height)}
          fill={fillCss(data.color)}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
      <div
        className={cn('shape-text', !data.text && !selected && 'shape-text-empty')}
        style={{ inset: textInset(data.shape) }}
      >
        <EditableText
          nodeId={id}
          value={data.text}
          field="text"
          maxLength={SHAPE_MAX_CHARS}
          placeholder="Text"
        />
      </div>
      <Handles side={sideInset(data.shape)} />
    </div>
  )
}

export const ShapeNode = memo(ShapeNodeView)
