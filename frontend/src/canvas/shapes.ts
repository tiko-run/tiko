export const SHAPES = [
  { kind: 'rectangle', name: 'Rectangle' },
  { kind: 'rounded', name: 'Rounded rectangle' },
  { kind: 'ellipse', name: 'Ellipse' },
  { kind: 'rhombus', name: 'Rhombus' },
  { kind: 'triangle', name: 'Triangle' },
  { kind: 'parallelogram', name: 'Parallelogram' },
  { kind: 'hexagon', name: 'Hexagon' },
  { kind: 'cylinder', name: 'Cylinder' },
] as const
export type ShapeKind = (typeof SHAPES)[number]['kind']

export const SHAPE_SIZE = { width: 160, height: 100 }
export const SHAPE_MIN = { width: 40, height: 40 }
export const SHAPE_MAX_CHARS = 500

// Share of the width cut off by a slanted side, and of the height taken by a cylinder's cap.
const SLANT = 0.2
const CAP = 0.12

const n = (value: number) => Math.round(value * 100) / 100

/** Outline of a shape that fills a `w` by `h` box, as an SVG path. */
export function shapePath(kind: ShapeKind, w: number, h: number): string {
  const [mx, my, s] = [n(w / 2), n(h / 2), n(w * SLANT)]
  switch (kind) {
    case 'rectangle':
      return `M0 0H${w}V${h}H0Z`
    case 'rounded': {
      const r = n(Math.min(w, h) * 0.2)
      const arc = `A${r} ${r} 0 0 1`
      return `M${r} 0H${n(w - r)}${arc} ${w} ${r}V${n(h - r)}${arc} ${n(w - r)} ${h}H${r}${arc} 0 ${n(h - r)}V${r}${arc} ${r} 0Z`
    }
    case 'ellipse':
      return `M0 ${my}A${mx} ${my} 0 1 0 ${w} ${my}A${mx} ${my} 0 1 0 0 ${my}Z`
    case 'rhombus':
      return `M${mx} 0L${w} ${my}L${mx} ${h}L0 ${my}Z`
    case 'triangle':
      return `M${mx} 0L${w} ${h}H0Z`
    case 'parallelogram':
      return `M${s} 0H${w}L${n(w - s)} ${h}H0Z`
    case 'hexagon':
      return `M${s} 0H${n(w - s)}L${w} ${my}L${n(w - s)} ${h}H${s}L0 ${my}Z`
    case 'cylinder': {
      const ry = n(h * CAP)
      const arc = `A${mx} ${ry} 0 0`
      // The second subpath is the front edge of the cap.
      return `M0 ${ry}${arc} 1 ${w} ${ry}V${n(h - ry)}${arc} 1 0 ${n(h - ry)}ZM0 ${ry}${arc} 0 ${w} ${ry}`
    }
  }
}

// Top, right, bottom, left, in percent of the box: the largest area the outline leaves for text.
const TEXT_INSET: Partial<Record<ShapeKind, [number, number, number, number]>> = {
  ellipse: [14.6, 14.6, 14.6, 14.6],
  rhombus: [25, 25, 25, 25],
  triangle: [50, 25, 0, 25],
  parallelogram: [0, SLANT * 100, 0, SLANT * 100],
  hexagon: [0, SLANT * 100, 0, SLANT * 100],
  cylinder: [CAP * 200, 0, CAP * 100, 0],
}

export function textInset(kind: ShapeKind): string {
  return (TEXT_INSET[kind] ?? [0, 0, 0, 0]).map((side) => `${side}%`).join(' ')
}
