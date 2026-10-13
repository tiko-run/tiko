import type { Edge, Node } from '@xyflow/react'
import type { ShapeKind } from '@/canvas/shapes'

// `source` is the tracker of `key`; cards saved before trackers could be mixed have none.
export type TaskCardData = { key: string; source?: string; collapsed?: boolean }
export type TaskCardNode = Node<TaskCardData, 'task_card'>

export type FrameData = { title: string }
export type FrameNode = Node<FrameData, 'frame'>

export const STICKY_COLORS = ['yellow', 'orange', 'pink', 'violet', 'blue', 'green'] as const
export type StickyColor = (typeof STICKY_COLORS)[number]
export type StickyData = { text: string; color: StickyColor }
export type StickyNode = Node<StickyData, 'sticky'>

// `none` leaves a shape see-through, `surface` fills it with the card surface.
export const SHAPE_COLORS = ['none', 'surface', ...STICKY_COLORS] as const
export type ShapeData = { shape: ShapeKind; text: string; color: (typeof SHAPE_COLORS)[number] }
export type ShapeNode = Node<ShapeData, 'shape'>

export type TextData = { text: string }
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
