import type { XYPosition } from '@xyflow/react'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { z } from 'zod'
import type { Task } from '@/api/tasks'
import type { TaskLink } from '@/canvas/tasks-context'
import type { PlanningState } from '@/planning/context'

/** What the board does for a module: things that reach outside the module's own content. */
export type ModuleHost = {
  /** Makes freshly resolved tasks show live data before the next refresh. */
  addTasks: (tasks: Task[]) => void
  /** Puts a card for the task on the board at a screen point. */
  ejectCard: (task: TaskLink, screen: XYPosition) => void
  /** Puts a sticky note with the text on the board at a screen point. */
  ejectNote: (text: string, screen: XYPosition) => void
}

export type ModuleViewProps<C> = {
  id: string
  content: C
  width: number
  height: number
  selected: boolean
  /** Shown over the dimmed board: width and height are the visible area, the content may scroll. */
  expanded: boolean
  /** Writes the module's content; goes through undo like any board change. */
  onChange: (next: C) => void
  host: ModuleHost
}

/** What the module's controls in the selection bar read and write. */
export type ModuleControlsProps<C> = Pick<ModuleViewProps<C>, 'content' | 'onChange'> & {
  /** Where their popovers open: away from the selection, like the bar's own. */
  side: 'top' | 'bottom'
  /** The Expand or Collapse button; the module puts it before its overflow menu. */
  expand?: ReactNode
}

export type ModuleDef<C> = {
  kind: string
  name: string
  description: string
  Icon: LucideIcon
  size: { width: number; height: number }
  minSize: { width: number; height: number }
  /** Body height the content needs; the block grows to it so nothing is hidden. */
  minHeight?: (content: C, planning: PlanningState) => number
  /** Can open over the dimmed board to be worked on at full size. */
  expandable?: boolean
  /** Expanded: width of the columns that stay put; the sideways scroll bar starts after them. */
  expandedInset?: (content: C, planning: PlanningState) => number
  defaults: () => C
  schema: z.ZodType<C>
  /** Live tasks inside the content, refreshed with the board's cards. */
  keys: (content: C) => TaskLink[]
  View: ComponentType<ModuleViewProps<C>>
  /** Controls in the selection bar while the module is selected alone. */
  Controls?: ComponentType<ModuleControlsProps<C>>
  /**
   * Takes in a card dropped at a point of the body (module coordinates, below the header).
   * Null leaves the card on the board.
   */
  acceptCard?: (
    content: C,
    task: TaskLink,
    at: XYPosition,
    width: number,
    planning: PlanningState,
  ) => C | null
  /** Texts inside the content that board search finds; a jump goes to the module. */
  searchable?: (content: C) => ModuleText[]
}

/** A text inside a module; `key` is a live task whose summary is searched too. */
export type ModuleText = { kind: 'row' | 'milestone'; key?: string; source?: string; text: string }

/** Keeps each definition typed against its own content while the list stays uniform. */
export function defineModule<C>(def: ModuleDef<C>): ModuleDef<unknown> {
  return def as ModuleDef<unknown>
}
