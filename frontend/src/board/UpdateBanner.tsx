import { ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useVersion } from '@/api/version'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

const CLOSED_AT = 'tiko.securityBannerClosedAt'
const CLOSED_FOR_MS = 24 * 3600_000

function closedRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(CLOSED_AT) ?? 0) < CLOSED_FOR_MS
  } catch {
    return false
  }
}

/** For admins: a security release stays in view until the instance is updated. */
export function UpdateBanner() {
  const info = useVersion().data
  const [closed, setClosed] = useState(closedRecently)
  if (info?.level !== 'security' || !info.latest || closed) return null
  const close = () => {
    try {
      localStorage.setItem(CLOSED_AT, String(Date.now()))
    } catch {
      // Storage blocked: closed for this page only.
    }
    setClosed(true)
  }
  return (
    // A wrapper places it: the alert's own `relative` would win over a class passed to it.
    <div className="absolute bottom-16 left-4 z-10 w-80">
      <Alert variant="destructive" className="shadow-md">
        <ShieldAlert />
        <AlertTitle>Security update available</AlertTitle>
        <AlertDescription>
          <span>
            Update to v{info.latest.version} to get a security fix.{' '}
            <a href={info.latest.url} target="_blank" rel="noreferrer" className="underline">
              See what's new
            </a>
          </span>
        </AlertDescription>
        <AlertAction>
          <Button variant="ghost" size="icon-xs" aria-label="Remind me tomorrow" onClick={close}>
            <X />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  )
}
