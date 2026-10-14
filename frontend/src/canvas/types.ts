import type { Edge, Node } from '@xyflow/react'
import type { ShapeKind } from '@/canvas/shapes'

// `source` is the tracker of `key`; cards saved before trackers could be mixed have none.
export type TaskCardData = { key: string; source?: string; collapsed?: boolean }
export type TaskCardNode = Node<TaskCardData, 'task_card'>

export const STICKY_COLORS = ['yellow', 'orange', 'pink', 'violet', 'blue', 'green'] as const
export type StickyColor = (typeof STICKY_COLORS)[number]

// Style fields are left out until someone sets them, so an older board keeps its look.
export const STROKES = [1, 1.5, 3] as const
export type Stroke = (typeof STROKES)[number]
export const TEXT_SIZES = ['small', 'medium', 'large'] as const
export type TextSize = (typeof TEXT_SIZES)[number]
/** Percent, 10 to 100 in steps of 5. */
type Faded = { opacity?: number }

// A frame saved before frames took a fill has no `color`; it reads as `none`.
export const FRAME_COLORS = ['none', ...STICKY_COLORS] as const
export type FrameData = { title: string; color?: (typeof FRAME_COLORS)[number] } & Faded
export type FrameNode = Node<FrameData, 'frame'>

export type StickyData = { text: string; color: StickyColor; bold?: boolean } & Faded
export type StickyNode = Node<StickyData, 'sticky'>

// `none` leaves a shape see-through, `surface` fills it with the card surface.
export const SHAPE_COLORS = ['none', 'surface', ...STICKY_COLORS] as const
export type ShapeData = {
  shape: ShapeKind
  text: string
  color: (typeof SHAPE_COLORS)[number]
  stroke?: Stroke
  dash?: boolean
  bold?: boolean
  size?: TextSize
} & Faded
export type ShapeNode = Node<ShapeData, 'shape'>

export type TextData = { text: string; bold?: boolean; size?: TextSize } & Faded
export type TextNode = Node<TextData, 'text'>

export type ModuleData = { kind: string; title?: string; content: unknown }
export type ModuleNode = Node<ModuleData, 'module'>

// The free end of an arrow that points somewhere instead of at an element.
export type AnchorNode = Node<Record<string, never>, 'anchor'>

export type TimerRepeat = 'daily' | 'weekdays' | 'weekly'
export type TimerData = {
  note: string
  /** ISO moment; null for a status timer that has not gone off yet. */
  dueAt?: string | null
  snoozedUntil?: string
  repeat?: TimerRepeat
  /** A status timer: goes off when the task leaves `status`; `changedTo` is set when it does. */
  watch?: { key: string; source?: string; status: string; changedTo?: string }
  done?: boolean
}
// A reminder; its parent, when it is not a frame, is the element it is attached to.
export type TimerNode = Node<TimerData, 'timer'>

export type AppNode =
  TaskCardNode | FrameNode | StickyNode | ShapeNode | TextNode | ModuleNode | AnchorNode | TimerNode
export type AppEdge = Edge
