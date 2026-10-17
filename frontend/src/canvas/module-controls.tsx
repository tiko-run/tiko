import { Maximize2, Minimize2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ModuleNode } from '@/canvas/types'
import { Button } from '@/components/ui/button'
import { findModule } from '@/modules/registry'

/** Opens a module over the board, or brings it back when it is open. */
export function ExpandToggle({
  expanded = false,
  onClick,
}: {
  expanded?: boolean
  onClick: () => void
}) {
  const Icon = expanded ? Minimize2 : Maximize2
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={expanded ? 'Collapse' : 'Expand'}
      title={expanded ? 'Collapse (Esc)' : 'Expand over the board'}
      onClick={onClick}
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </Button>
  )
}

/** The module's own controls for the selection bar; null when it has none or cannot read its content. */
export function moduleControls(
  node: ModuleNode,
  onChange: (content: unknown) => void,
  side: 'top' | 'bottom',
  onExpand?: () => void,
): ReactNode {
  const def = findModule(node.data.kind)
  if (!def) return null
  const parsed = def.schema.safeParse(node.data.content)
  if (!parsed.success) return null
  const expand = def.expandable && onExpand ? <ExpandToggle onClick={onExpand} /> : undefined
  if (!def.Controls) return expand ?? null
  return <def.Controls content={parsed.data} onChange={onChange} side={side} expand={expand} />
}
