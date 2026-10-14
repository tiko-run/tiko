import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { POLL_TIMEOUT_MS, type UpdateInfo, useUpdate } from '@/api/update'
import { getVersion } from '@/api/version'

function reload() {
  window.location.reload()
}

/** For admins: reloads the page once a running update has brought the new version up. */
export function ReloadAfterUpdate() {
  const update = useUpdate(true)
  const status = update.data?.status
  const [watching, setWatching] = useState(false)
  if (status?.state === 'running' && !watching) setWatching(true)
  // The API is down while it restarts, so the last answer stays and the request fails.
  const restarting = status?.state === 'running' && (update.isError || status.step === 'restart')
  const version = useQuery({
    queryKey: ['version', 'after-update'],
    queryFn: () => getVersion({ signal: AbortSignal.timeout(POLL_TIMEOUT_MS) }),
    enabled: watching && (restarting || status?.state === 'done'),
    refetchInterval: 2000,
    retry: false,
  })
  // web restarts after api, so the new API alone would still serve the old page.
  const arrived = status?.state === 'done' && version.data?.version === status.target
  useEffect(() => {
    if (arrived) reload()
  }, [arrived])
  return null
}

/** The download bar of a running update, then the restart note. */
export function UpdateSteps({
  status,
  restarting,
}: {
  status: NonNullable<UpdateInfo['status']>
  restarting: boolean
}) {
  if (restarting || status.state === 'done') {
    return (
      <span className="text-muted-foreground">Restarting tiko. The page reloads by itself.</span>
    )
  }
  const percent = status.total ? Math.round((100 * status.downloaded) / status.total) : 0
  return (
    <>
      <span className="text-muted-foreground">
        Downloading the new version{status.total ? ` · ${percent}%` : '…'}
      </span>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </>
  )
}

/** For everyone: the instance moved to a new version under an open page. */
export function UpdatedNotice() {
  // Its own check, every minute: the release check of About is every 5 minutes.
  const version = useQuery({
    queryKey: ['version', 'running'],
    queryFn: getVersion,
    refetchInterval: 60_000,
  }).data?.version
  const first = useRef<string | null>(null)
  useEffect(() => {
    if (!version) return
    if (first.current === null) first.current = version
    else if (version !== first.current) {
      toast(`tiko was updated to v${version}`, {
        id: 'tiko-updated',
        duration: Infinity,
        action: { label: 'Reload', onClick: reload },
      })
    }
  }, [version])
  return null
}
