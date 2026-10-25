import {
  FRAME_COLORS,
  SHAPE_COLORS,
  STICKY_COLORS,
  type AppNode,
  type Stroke,
  type TextSize,
} from '@/canvas/types'

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

export type Style = {
  color?: Fill
  opacity?: number
  stroke?: Stroke
  dash?: boolean
  bold?: boolean
  size?: TextSize
}
export type StyleProp = Exclude<keyof Style, 'color'>

// The element types that take each property; a task card stays opaque, it shows live data.
const TAKES: Record<StyleProp, readonly string[]> = {
  opacity: ['sticky', 'shape', 'frame', 'text'],
  stroke: ['shape'],
  dash: ['shape'],
  bold: ['sticky', 'shape', 'text'],
  size: ['shape', 'text'],
}

// What a field left out means: the look elements had before they took the property.
const STYLE_DEFAULTS: Required<Pick<Style, StyleProp>> = {
  opacity: 100,
  stroke: 1.5,
  dash: false,
  bold: false,
  size: 'medium',
}

// Medium is each type's own size from before, so text saved without a size keeps it.
const TEXT_PX: Record<string, Record<TextSize, number>> = {
  shape: { small: 12, medium: 14, large: 20 },
  text: { small: 12, medium: 16, large: 24 },
}
/** A color at the element's opacity; fading colors, not the node, keeps its selection ring and handles solid. */
export const faded = (color: string, opacity: number | undefined) =>
  opacity === undefined || opacity === 100
    ? color
    : `color-mix(in oklch, ${color} ${opacity}%, transparent)`

export const textPx = (kind: 'shape' | 'text', size: TextSize | undefined) =>
  TEXT_PX[kind][size ?? 'medium']

/** Whether every one of the nodes takes the property. */
export const shares = (nodes: AppNode[], prop: StyleProp) =>
  nodes.length > 0 && nodes.every((n) => TAKES[prop].includes(n.type ?? ''))

export function styleOf<P extends StyleProp>(node: AppNode, prop: P): Required<Style>[P] {
  const value = (node.data as Style)[prop]
  return (value ?? STYLE_DEFAULTS[prop]) as Required<Style>[P]
}

/** The different values of the property among the nodes, in the order they first appear. */
export const stylesOf = <P extends StyleProp>(nodes: AppNode[], prop: P) => [
  ...new Set(nodes.map((n) => styleOf(n, prop))),
]

/** The node with what of the style it takes, or the node itself when nothing changes. */
export function withStyle(node: AppNode, style: Style): AppNode {
  const kind = node.type ?? ''
  let data = node.data as Record<string, unknown>
  for (const [prop, value] of Object.entries(style) as [keyof Style, unknown][]) {
    if (value === undefined) continue
    const takes =
      prop === 'color' ? FILLS[kind]?.includes(value as Fill) : TAKES[prop].includes(kind)
    const now = prop === 'color' ? fillOf(node) : styleOf(node, prop)
    if (takes && now !== value) data = { ...data, [prop]: value }
  }
  return data === node.data ? node : ({ ...node, data } as AppNode)
}

export type Kind = Exclude<NonNullable<AppNode['type']>, 'anchor'>

export const KIND_NAMES: Record<Kind, [one: string, many: string]> = {
  task_card: ['Task card', 'Task cards'],
  frame: ['Frame', 'Frames'],
  sticky: ['Sticky note', 'Sticky notes'],
  shape: ['Shape', 'Shapes'],
  text: ['Text', 'Texts'],
  module: ['Module', 'Modules'],
  timer: ['Reminder', 'Reminders'],
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
