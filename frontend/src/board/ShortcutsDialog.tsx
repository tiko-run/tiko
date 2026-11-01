import { Fragment } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { formatShortcut, SHORTCUTS, type ShortcutId } from '@/lib/shortcuts'
import { Scroller } from '@/components/Scroller'

const GROUPS = ['Tools', 'Edit', 'Canvas', 'General'] as const

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

/** Lists every shortcut from the registry, grouped. */
export function ShortcutsDialog({ open, onOpenChange }: Props) {
  const ids = Object.keys(SHORTCUTS) as ShortcutId[]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A read-only list: nothing to focus, so no ring lands on the close button. */}
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? anywhere on the board to open this list.</DialogDescription>
        </DialogHeader>
        <Scroller viewportClassName="flex max-h-[60vh] flex-col gap-4">
          {GROUPS.map((group) => (
            <section key={group} className="flex flex-col gap-1.5">
              <h3 className="text-muted-foreground text-[13px] font-medium">{group}</h3>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
                {ids
                  .filter((id) => SHORTCUTS[id].group === group)
                  .map((id) => (
                    <Fragment key={id}>
                      <dt>{SHORTCUTS[id].label}</dt>
                      <dd className="flex items-center justify-end gap-1.5">
                        {formatShortcut(id).map((combo, i) => (
                          <Fragment key={combo.join('+')}>
                            {i > 0 && <span className="text-muted-foreground text-xs">or</span>}
                            <KbdGroup>
                              {combo.map((key) => (
                                <Kbd key={key}>{key}</Kbd>
                              ))}
                            </KbdGroup>
                          </Fragment>
                        ))}
                      </dd>
                    </Fragment>
                  ))}
              </dl>
            </section>
          ))}
        </Scroller>
      </DialogContent>
    </Dialog>
  )
}
