// Stage fills sit at the sticky note lightness, so a plan reads as quietly as the board.
export function stageColors(hue: number) {
  return {
    background: `oklch(0.93 0.05 ${hue})`,
    color: `oklch(0.38 0.09 ${hue})`,
    boxShadow: `inset 0 0 0 1px oklch(0.85 0.06 ${hue})`,
  }
}
