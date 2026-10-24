import { type NodeProps } from '@xyflow/react'
import { Resizer } from '@/canvas/nodes/Resizer'
import { memo } from 'react'
import { EditableText } from '@/canvas/nodes/EditableText'
import { Handles } from '@/canvas/nodes/Handles'
import { SHAPE_MAX_CHARS, SHAPE_MIN, shapePath, sideInset, textInset } from '@/canvas/shapes'
import { fillCss, textPx } from '@/canvas/selection-props'
import type { ShapeNode as ShapeNodeType } from '@/canvas/types'
import { cn } from '@/lib/utils'
import { useReadOnly } from '@/canvas/readonly'

function ShapeNodeView({ id, data, selected, width = 0, height = 0 }: NodeProps<ShapeNodeType>) {
  const readOnly = useReadOnly()
  const stroke = data.stroke ?? 1.5
  // On the drawing and the text as one layer, not the node, so the selection outline and handles stay solid.
  const opacity = data.opacity === undefined ? undefined : data.opacity / 100

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
      <Resizer
        isVisible={selected && !readOnly}
        minWidth={SHAPE_MIN.width}
        minHeight={SHAPE_MIN.height}
      />
      <div className="absolute inset-0" style={{ opacity }}>
        <svg aria-hidden className="absolute inset-0 size-full overflow-visible">
          <path
            d={shapePath(data.shape, width, height)}
            fill={fillCss(data.color)}
            stroke="currentColor"
            strokeWidth={stroke}
            // Dashes scale with the width, so a 3px dash reads like a 1px one.
            strokeDasharray={data.dash ? `${stroke * 4} ${stroke * 3}` : undefined}
            strokeLinejoin="round"
          />
        </svg>
        <div
          className={cn('shape-text', !data.text && !selected && 'shape-text-empty')}
          style={{
            inset: textInset(data.shape),
            fontSize: textPx('shape', data.size),
            fontWeight: data.bold ? 600 : undefined,
          }}
        >
          <EditableText
            nodeId={id}
            value={data.text}
            field="text"
            maxLength={SHAPE_MAX_CHARS}
            placeholder="Text"
          />
        </div>
      </div>
      <Handles side={sideInset(data.shape)} />
    </div>
  )
}

export const ShapeNode = memo(ShapeNodeView)
