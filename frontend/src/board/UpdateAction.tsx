import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { startUpdate, useUpdate, type UpdateInfo } from '@/api/update'
import type { VersionInfo } from '@/api/version'
import {
  reload,
  UpdateSteps,
  useNewBuildServed,
  watchedUpdate,
  watchUpdate,
} from '@/board/UpdateProgress'
import { Button } from '@/components/ui/button'
import { toastError } from '@/lib/toast'
import { Scroller } from '@/components/Scroller'

const PLATFORM = { railway: 'Railway', render: 'Render' }
const INSTALLERS = [
  ['Linux, macOS', 'curl -fsSL https://tiko.run/install.sh | sh'],
  ['Windows', 'irm https://tiko.run/install.ps1 | iex'],
]
const INSTALLER_GUIDE = 'https://docs.tiko.run/updates/#when-a-release-needs-the-installer'

function NeedsInstaller({ version }: { version: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span>
        v{version} cannot be installed with one click. Run the installer again on the server; your
        boards stay.{' '}
        <a href={INSTALLER_GUIDE} target="_blank" rel="noreferrer" className="text-primary">
          How it works
        </a>
      </span>
      {INSTALLERS.map(([system, command]) => (
        <div key={system} className="flex flex-col">
          <span className="text-muted-foreground">{system}</span>
          <code className="font-mono text-[11px] select-all">{command}</code>
        </div>
      ))}
    </div>
  )
}

function Failed({ status }: { status: NonNullable<UpdateInfo['status']> }) {
  return (
    <div className="text-destructive flex flex-col gap-0.5">
      <span>The last update failed: {status.error}</span>
      {status.log.length > 0 && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">Log</summary>
          <Scroller viewportClassName="max-h-32">
            <pre className="font-mono text-[11px] whitespace-pre-wrap">{status.log.join('\n')}</pre>
          </Scroller>
        </details>
      )}
    </div>
  )
}

/** The way to update from About: the button for an admin, or what to do instead. */
export function UpdateAction({ info, admin }: { info: VersionInfo; admin: boolean }) {
  const queryClient = useQueryClient()
  const query = useUpdate(true)
  const update = query.data
  const [confirming, setConfirming] = useState(false)
  const start = useMutation({
    mutationFn: startUpdate,
    onSuccess: (fresh) => queryClient.setQueryData(['update'], fresh),
    onError: toastError,
  })
  const status = update?.status
  // Only an update this page saw running ends in a reload; an older finished one is history.
  const updating =
    status?.state === 'running' || (status?.state === 'done' && status.target === watchedUpdate())
  // The API is down while it restarts, so the last answer stays and the request fails.
  const restarting =
    updating && (query.isError || status?.step === 'restart' || status?.state === 'done')
  // The updater reports done only after it cleans up; the new page is there before that.
  const served = useNewBuildServed(restarting)
  const runningTarget = status?.state === 'running' ? status.target : null
  useEffect(() => {
    if (runningTarget) watchUpdate(runningTarget)
  }, [runningTarget])
  if (!update) return null
  if (status && updating) {
    if (served || status.state === 'done') {
      return (
        <div role="status" className="flex flex-col gap-1.5">
          <span>v{status.target} is ready.</span>
          <Button size="sm" className="self-start" onClick={reload}>
            Reload
          </Button>
        </div>
      )
    }
    return (
      <div role="status" className="flex flex-col gap-1.5">
        <span>Updating to v{status.target}…</span>
        <UpdateSteps status={status} restarting={restarting} />
      </div>
    )
  }
  if (!admin) return <span className="text-muted-foreground">Ask the server admin to update.</span>
  if (!update.available) {
    return (
      <span className="text-muted-foreground">
        {update.hosting
          ? `Redeploy tiko on ${PLATFORM[update.hosting]} to update.`
          : 'Run the installer again to update.'}
      </span>
    )
  }
  if (info.installer) {
    const marked = info.newer.find((release) => release.installer) ?? info.latest
    return <NeedsInstaller version={marked?.version ?? ''} />
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
