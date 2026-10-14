import { FRAME_COLORS, SHAPE_COLORS, STICKY_COLORS, type AppNode } from '@/canvas/types'

export type Fill = (typeof SHAPE_COLORS)[number]

// The fills each element type takes; a type that is not here has no fill.
const FILLS: Partial<Record<string, readonly Fill[]>> = {
  sticky: STICKY_COLORS,
  shape: SHAPE_COLORS,
  frame: FRAME_COLORS,
}

const PLAIN: Partial<Record<Fill, string>> = { none: 'none', surface: 'var(--card)' }
export const fillCss = (fill: string) => PLAIN[fill as Fill] ?? `var(--sticky-${fill})`
export const fillLabel = (fill: Fill) =>
  fill === 'none' ? 'no fill' : fill === 'surface' ? 'plain fill' : `${fill} fill`
// "No fill" is drawn as a struck-through swatch.
export const NO_FILL =
  'linear-gradient(to top right, var(--card) 44%, var(--destructive) 44% 56%, var(--card) 56%)'

/** What the bar works on: an anchor is the loose end of an arrow, not an element. */
export const barNodes = (nodes: AppNode[]) => nodes.filter((n) => n.selected && n.type !== 'anchor')

export function fillOf(node: AppNode): Fill | undefined {
  if (node.type === 'shape') return node.data.color
  if (node.type === 'sticky') return node.data.color
  if (node.type === 'frame') return node.data.color ?? 'none'
  return undefined
}

/** The fills every one of the nodes takes; none when one of them has no fill at all. */
export const fillChoices = (nodes: AppNode[]): Fill[] =>
  nodes.length === 0
    ? []
    : SHAPE_COLORS.filter((fill) => nodes.every((n) => FILLS[n.type ?? '']?.includes(fill)))

/** The different fills among the nodes, in palette order. */
export function fillsOf(nodes: AppNode[]): Fill[] {
  const used = new Set(nodes.map(fillOf))
  return SHAPE_COLORS.filter((fill) => used.has(fill))
}

/** The node in that fill, or the node itself when it does not take it. */
export function withFill(node: AppNode, fill: Fill): AppNode {
  if (!FILLS[node.type ?? '']?.includes(fill) || fillOf(node) === fill) return node
  return { ...node, data: { ...node.data, color: fill } } as AppNode
}

export type Kind = Exclude<NonNullable<AppNode['type']>, 'anchor'>

export const KIND_NAMES: Record<Kind, [one: string, many: string]> = {
  task_card: ['Task card', 'Task cards'],
  frame: ['Frame', 'Frames'],
  sticky: ['Sticky note', 'Sticky notes'],
  shape: ['Shape', 'Shapes'],
  text: ['Text', 'Texts'],
  module: ['Module', 'Modules'],
  timer: ['Timer', 'Timers'],
}

/** How many nodes of each type, in the order the types first appear. */
export function kindCounts(nodes: AppNode[]): { kind: Kind; count: number }[] {
  const counts = new Map<Kind, number>()
  for (const node of nodes) {
    const kind = node.type as Kind
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, count]) => ({ kind, count }))
}

/** "Sticky note", "3 sticky notes" or, for several types, "5 objects". */
export function selectionLabel(nodes: AppNode[]) {
  const kinds = kindCounts(nodes)
  if (kinds.length !== 1) return `${nodes.length} objects`
  const [one, many] = KIND_NAMES[kinds[0].kind]
  return nodes.length === 1 ? one : `${nodes.length} ${many.toLowerCase()}`
}
