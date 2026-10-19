import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Badge } from '@/components/ui/badge'

const DAY_MS = 24 * 3600 * 1000

/** How long a demo visitor's boards are still kept, in whole days. */
export function demoDaysLeft(expiresAt: string, now = Date.now()): string {
  const days = Math.max(1, Math.ceil((Date.parse(expiresAt) - now) / DAY_MS))
  return days === 1 ? '1 day' : `${days} days`
}

/** Tells a demo visitor that their boards are temporary. */
export function DemoMark({ expiresAt }: { expiresAt: string }) {
  const queryClient = useQueryClient()
  // The visitor may have signed up in another tab: coming back to this one asks who they are now.
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['auth'] })
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [queryClient])
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground mx-1"
      title="Only you see your boards. They are deleted after 7 days without a visit; keep real work data out of the demo."
    >
      Demo · {demoDaysLeft(expiresAt)}
    </Badge>
  )
}
