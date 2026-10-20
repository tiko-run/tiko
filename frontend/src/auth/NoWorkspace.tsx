import { useMutation } from '@tanstack/react-query'
import { signOut } from '@/api/auth'
import { Emblem } from '@/components/Emblem'
import { Button } from '@/components/ui/button'
import { toastError } from '@/lib/toast'
import { openSettings } from '@/settings/store'

/** What a person removed from their workspace sees: the account works, the boards are gone. */
export function NoWorkspace() {
  const leave = useMutation({
    mutationFn: signOut,
    // A full load drops the cache of the account that signed out.
    onSuccess: () => window.location.reload(),
    onError: toastError,
  })
  return (
    <div className="absolute top-1/2 left-1/2 flex w-80 -translate-x-1/2 -translate-y-1/2 flex-col gap-4">
      <p className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.03em]">
        <Emblem className="size-6" />
        tiko
      </p>
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-medium">You are not in a workspace.</p>
        <p className="text-muted-foreground text-[14px]">
          Ask an admin for an invite link and open it here.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => openSettings('profile')}>
          Settings
        </Button>
        <Button variant="ghost" size="sm" disabled={leave.isPending} onClick={() => leave.mutate()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}
