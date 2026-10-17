import { Maximize2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ModuleNode } from '@/canvas/types'
import { Button } from '@/components/ui/button'
import { findModule } from '@/modules/registry'

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
  const expand = def.expandable && onExpand
  if (!parsed.success || (!def.Controls && !expand)) return null
  return (
    <>
      {def.Controls && <def.Controls content={parsed.data} onChange={onChange} side={side} />}
      {expand && (
        <Button size="sm" variant="ghost" title="Open over the board" onClick={onExpand}>
          <Maximize2 className="size-4" strokeWidth={1.75} />
          Expand
        </Button>
      )}
    </>
  )
}
