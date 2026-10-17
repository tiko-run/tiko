import { Minimize2, Puzzle } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'
import type { ModuleNode } from '@/canvas/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ExpandedContext } from '@/modules/expanded'
import { ModuleHostContext } from '@/modules/host-context'
import { findModule } from '@/modules/registry'
import { cn } from '@/lib/utils'

type Props = {
  node: ModuleNode
  readOnly: boolean
  onChange: (content: unknown) => void
  onClose: () => void
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement)

/** A module over the dimmed board at full size; it edits the same block the board shows. */
export function ModuleExpanded({ node, readOnly, onChange, onClose }: Props) {
  const host = useContext(ModuleHostContext)
  const [body, setBody] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const def = findModule(node.data.kind)
  const parsed = def?.schema.safeParse(node.data.content)

  useEffect(() => {
    if (!body) return
    const measure = () => setSize({ width: body.clientWidth, height: body.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    return () => observer.disconnect()
  }, [body])

  if (!def || !parsed?.success) return null
  const Icon = def.Icon ?? Puzzle

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-module-expanded
        showCloseButton={false}
        aria-describedby={undefined}
        overlayClassName="bg-black/50"
        // The body takes focus so arrow keys scroll it and no button opens with a ring.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          body?.focus()
        }}
        // Esc in a field ends the edit there; the view stays open.
        onEscapeKeyDown={(event) => {
          if (typing(event.target)) event.preventDefault()
        }}
        className="bg-card inset-4 flex w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-none md:inset-8"
      >
        <header className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
          <Icon className="text-muted-foreground mr-1 size-4 shrink-0" strokeWidth={1.75} />
          <DialogTitle className="mr-2 min-w-0 truncate text-[13px] font-medium">
            {node.data.title || def.name}
          </DialogTitle>
          {!readOnly && def.Controls && (
            <def.Controls content={parsed.data} onChange={onChange} side="bottom" />
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse"
            title="Collapse (Esc)"
            className="ml-auto"
            onClick={onClose}
          >
            <Minimize2 strokeWidth={1.75} />
          </Button>
        </header>
        <div
          ref={setBody}
          tabIndex={-1}
          className="relative min-h-0 flex-1 overflow-auto outline-none"
        >
          {/* A viewer scrolls the plan but cannot change it. */}
          <div className={cn('h-full', readOnly && 'pointer-events-none')}>
            {size && (
              <ExpandedContext.Provider value>
                <def.View
                  id={node.id}
                  content={parsed.data}
                  width={size.width}
                  height={size.height}
                  selected={!readOnly}
                  expanded
                  onChange={onChange}
                  host={host}
                />
              </ExpandedContext.Provider>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
