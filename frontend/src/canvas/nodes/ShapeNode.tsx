import { NodeResizer, NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { EditableText } from '@/canvas/nodes/EditableText'
import { Handles } from '@/canvas/nodes/Handles'
import { SHAPE_MAX_CHARS, SHAPE_MIN, shapePath, sideInset, textInset } from '@/canvas/shapes'
import { SHAPE_COLORS, type ShapeNode as ShapeNodeType } from '@/canvas/types'
import { cn } from '@/lib/utils'
import { useReadOnly } from '@/canvas/readonly'

const FILLS: Record<string, string> = { none: 'none', surface: 'var(--card)' }
const fillOf = (color: string) => FILLS[color] ?? `var(--sticky-${color})`
const LABELS: Record<string, string> = { none: 'no fill', surface: 'plain fill' }
// "No fill" is drawn as a struck-through swatch.
const NO_FILL =
  'linear-gradient(to top right, var(--card) 44%, var(--destructive) 44% 56%, var(--card) 56%)'

function ShapeNodeView({
  id,
  data,
  selected,
  dragging,
  width = 0,
  height = 0,
}: NodeProps<ShapeNodeType>) {
  const readOnly = useReadOnly()
  const { updateNodeData } = useReactFlow()

  return (
    <div
      className={cn('relative h-full w-full', selected && 'outline-primary outline-1')}
      // The outline and the text share one color, dark on a filled shape in both themes.
      style={{ color: data.color in FILLS ? undefined : 'var(--sticky-foreground)' }}
    >
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={SHAPE_MIN.width}
        minHeight={SHAPE_MIN.height}
      />
      <NodeToolbar
        // Hidden while dragging: it covers the guides and the elements next to it.
        isVisible={readOnly || dragging ? false : undefined}
        position={Position.Top}
        className="flex gap-1 rounded-md border bg-card p-1 shadow-md"
      >
        {SHAPE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={LABELS[color] ?? `${color} fill`}
            aria-pressed={data.color === color}
            onClick={() => updateNodeData(id, { color })}
            className={cn(
              'size-5 rounded-full border',
              data.color === color && 'ring-primary ring-2 ring-offset-1',
            )}
            style={{ background: color === 'none' ? NO_FILL : fillOf(color) }}
          />
        ))}
      </NodeToolbar>
      <svg aria-hidden className="absolute inset-0 size-full overflow-visible">
        <path
          d={shapePath(data.shape, width, height)}
          fill={fillOf(data.color)}
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
