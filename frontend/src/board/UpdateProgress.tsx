import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { POLL_TIMEOUT_MS, type UpdateInfo } from '@/api/update'
import { getVersion } from '@/api/version'

export function reload() {
  window.location.reload()
}

// Module state: About unmounts when it closes, and the page's version info moves on when the
// new API answers, while the update this page started still needs its Reload.
let watched: string | null = null

/** The target of the update this page saw running, if any. */
export function watchedUpdate() {
  return watched
}

export function watchUpdate(target: string) {
  watched = target
}

const BUNDLE = /\/assets\/index-[\w-]+\.js/

/** Whether the web container serves another build than the one this page runs. */
export function useNewBuildServed(enabled: boolean) {
  const [loaded] = useState(
    () =>
      document
        .querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')
        ?.src.match(BUNDLE)?.[0] ?? null,
  )
  const served = useQuery({
    queryKey: ['served-build'],
    queryFn: async () => {
      const page = await fetch('/', {
        cache: 'no-store',
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      })
      return (await page.text()).match(BUNDLE)?.[0] ?? null
    },
    enabled: enabled && loaded !== null,
    refetchInterval: 1500,
    retry: false,
  }).data
  return !!served && served !== loaded
}

/** The download bar of a running update, then the restart note. */
export function UpdateSteps({
  status,
  restarting,
}: {
  status: NonNullable<UpdateInfo['status']>
  restarting: boolean
}) {
  if (restarting) {
    return <span className="text-muted-foreground">Restarting tiko…</span>
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
