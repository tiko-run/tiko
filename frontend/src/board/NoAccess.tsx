import { Emblem } from '@/components/Emblem'
import { Button } from '@/components/ui/button'
import { goTo } from '@/lib/navigation'

/** A board address the person cannot open; says nothing about whether the board exists. */
export function NoAccess() {
  return (
    <div className="absolute top-1/2 left-1/2 flex w-80 -translate-x-1/2 -translate-y-1/2 flex-col gap-4">
      <p className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.03em]">
        <Emblem className="size-6" />
        tiko
      </p>
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-medium">You don't have access to this board.</p>
        <p className="text-muted-foreground text-[14px]">
          Ask the person who sent the link to add you in Share.
        </p>
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={() => goTo(null)}>
          Go to your boards
        </Button>
      </div>
    </div>
  )
}
