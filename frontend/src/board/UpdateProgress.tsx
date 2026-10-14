import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useUpdate } from '@/api/update'
import { getVersion } from '@/api/version'
import { Button } from '@/components/ui/button'

function reload() {
  window.location.reload()
}

/** For admins: the steps of a running update, then a reload on the new version. */
export function UpdateProgress() {
  const update = useUpdate(true)
  const status = update.data?.status
  const running = status?.state === 'running'
  const [watching, setWatching] = useState(false)
  if (running && !watching) setWatching(true)
  const target = status?.target
  // The API is down while it restarts, so the last answer stays and the request fails.
  const restarting = running && (update.isError || status?.step === 'restart')
  const version = useQuery({
    queryKey: ['version', 'after-update'],
    queryFn: getVersion,
    enabled: watching && (restarting || status?.state === 'done'),
    refetchInterval: 2000,
    retry: false,
  })
  // web restarts after api, so the new API alone would still serve the old page.
  const arrived = status?.state === 'done' && version.data?.version === target
  useEffect(() => {
    if (arrived) reload()
  }, [arrived])

  if (!watching || !status) return null
  if (status.state === 'failed') {
    return (
      <div className="bg-card absolute bottom-16 left-4 z-10 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-1.5 rounded-lg border p-3 text-[13px] shadow-md">
        <span className="text-destructive font-medium">The update failed</span>
        <span>{status.error}</span>
        <span className="text-muted-foreground">
          tiko runs the previous version again. About has the log.
        </span>
        <Button size="sm" variant="ghost" className="self-end" onClick={() => setWatching(false)}>
          Close
        </Button>
      </div>
    )
  }
  const percent = status.total ? Math.round((100 * status.downloaded) / status.total) : 0
  return (
    <div
      role="status"
      className="bg-card absolute bottom-16 left-4 z-10 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2 rounded-lg border p-3 text-[13px] shadow-md"
    >
      <span className="flex items-center gap-2 font-medium">
        <Loader2 className="size-4 animate-spin" />
        Updating to v{target}
      </span>
      {restarting || status.state === 'done' ? (
        <span className="text-muted-foreground">Restarting tiko. The page reloads by itself.</span>
      ) : (
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
      )}
    </div>
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
