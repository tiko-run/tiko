import type { ReactNode } from 'react'
import type { ModuleNode } from '@/canvas/types'
import { findModule } from '@/modules/registry'

/** The module's own controls for the selection bar; null when it has none or cannot read its content. */
export function moduleControls(node: ModuleNode, onChange: (content: unknown) => void): ReactNode {
  const def = findModule(node.data.kind)
  if (!def?.Controls) return null
  const parsed = def.schema.safeParse(node.data.content)
  if (!parsed.success) return null
  return <def.Controls content={parsed.data} onChange={onChange} />
}
