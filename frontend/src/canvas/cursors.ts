import type { Tool } from '@/canvas/Toolbar'

// Shapes of the toolbar's Lucide icons, so the cursor shows the tool that was picked.
const ICONS: Partial<Record<Tool, string>> = {
  frame: '<path d="M22 6H2M22 18H2M6 2v20M18 2v20"/>',
  sticky:
    '<path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/>',
  text: '<path d="M12 4v16M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2M9 20h6"/>',
  timer:
    '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6m20 0-3-3M6.38 18.7 4 21m13.64-2.33L20 21"/>',
  shape:
    '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
}

const HOT = 7
const CROSS = `<path d="M${HOT} 1v12M1 ${HOT}h12"/>`

// A light halo under a dark stroke reads on both themes and on any fill below the pointer.
function cursorSvg(icon: string) {
  // The icon is drawn at 3/4 size, so its stroke is widened back to match the crosshair.
  const layer = (color: string, width: number) =>
    `<g fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">` +
    `${CROSS}<g transform="translate(13 13) scale(0.75)" stroke-width="${width / 0.75}">${icon}</g></g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${layer('white', 4)}${layer('#1c1c1c', 1.75)}</svg>`
}

/** The CSS cursor of a creation tool: a crosshair with the tool's icon, or none for other tools. */
export function toolCursor(tool: Tool) {
  const icon = ICONS[tool]
  if (!icon) return undefined
  return `url("data:image/svg+xml,${encodeURIComponent(cursorSvg(icon))}") ${HOT} ${HOT}, crosshair`
}
