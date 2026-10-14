import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { startUpdate, useUpdate, type UpdateInfo } from '@/api/update'
import type { VersionInfo } from '@/api/version'
import { Button } from '@/components/ui/button'
import { toastError } from '@/lib/toast'

const PLATFORM = { railway: 'Railway', render: 'Render' }

function Failed({ status }: { status: NonNullable<UpdateInfo['status']> }) {
  return (
    <div className="text-destructive flex flex-col gap-0.5">
      <span>The last update failed: {status.error}</span>
      {status.log.length > 0 && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">Log</summary>
          <pre className="max-h-32 overflow-auto font-mono text-[11px] whitespace-pre-wrap">
            {status.log.join('\n')}
          </pre>
        </details>
      )}
    </div>
  )
}

/** The way to update from About: the button for an admin, or what to do instead. */
export function UpdateAction({ info, admin }: { info: VersionInfo; admin: boolean }) {
  const queryClient = useQueryClient()
  const update = useUpdate(true).data
  const [confirming, setConfirming] = useState(false)
  const start = useMutation({
    mutationFn: startUpdate,
    onSuccess: (fresh) => queryClient.setQueryData(['update'], fresh),
    onError: toastError,
  })
  if (!update) return null
  const status = update.status
  if (status?.state === 'running') {
    return <span className="text-muted-foreground">Updating to v{status.target}…</span>
  }
  if (!admin) return <span className="text-muted-foreground">Ask an admin to update.</span>
  if (!update.available) {
    return (
      <span className="text-muted-foreground">
        {update.hosting
          ? `Redeploy tiko on ${PLATFORM[update.hosting]} to update.`
          : 'Run the installer again to update.'}
      </span>
    )
  }
  const breaking = info.newer.filter((release) => release.level === 'breaking')
  return (
    <div className="flex flex-col gap-1.5">
      {status?.state === 'failed' && <Failed status={status} />}
      {confirming ? (
        <div className="flex flex-col gap-1.5">
          <span>
            {breaking.length === 1 ? (
              <>
                v{breaking[0].version} changes how something works.{' '}
                <a href={breaking[0].url} target="_blank" rel="noreferrer" className="text-primary">
                  Read the notes
                </a>{' '}
                before you update.
              </>
            ) : (
              'Some of these releases change how something works. Read their notes before you update.'
            )}
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" disabled={start.isPending} onClick={() => start.mutate()}>
              Update anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          className="self-start"
          disabled={start.isPending}
          onClick={() => (breaking.length ? setConfirming(true) : start.mutate())}
        >
          Update now
        </Button>
      )}
    </div>
  )
}
