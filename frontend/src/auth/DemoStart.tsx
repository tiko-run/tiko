import { useMutation } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { ApiError } from '@/api/client'
import { startDemo } from '@/api/auth'
import { Emblem } from '@/components/Emblem'
import { Button } from '@/components/ui/button'

function message(error: Error) {
  if (error instanceof ApiError && error.code === 'too_many_attempts') {
    const minutes = Math.ceil((error.retryAfter ?? 60) / 60)
    return `Too many demos from this address. Try again in ${minutes} min.`
  }
  return error.message
}

/** The demo page: one button to a board of your own, the sign-in form a link away. */
export function DemoStart({ onStarted }: { onStarted: () => void }) {
  const start = useMutation({ mutationFn: startDemo, onSuccess: onStarted })
  return (
    <div className="absolute top-1/2 left-1/2 flex w-80 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 text-center">
      <p className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.03em]">
        <Emblem className="size-6" />
        tiko
      </p>
      <p className="text-muted-foreground text-[14px]">Infinite canvas for your tasks</p>
      <Button className="mt-2 w-full" disabled={start.isPending} onClick={() => start.mutate()}>
        <Play strokeWidth={1.75} />
        Try the demo
      </Button>
      <p className="text-muted-foreground text-[13px]">
        No account needed. Only you see your board; it is deleted after 7 days without a visit. Keep
        real work data out of the demo.
      </p>
      {start.isError && <p className="text-destructive text-sm">{message(start.error)}</p>}
      <p className="text-muted-foreground mt-2 text-[13px]">
        Already have an account?{' '}
        <Button asChild variant="link" className="h-auto p-0 text-[13px]">
          <a href="/">Sign in</a>
        </Button>
      </p>
    </div>
  )
}
