import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { getAuthStatus } from '@/api/auth'
import { listBoards } from '@/api/boards'
import { AUTH_REQUIRED_EVENT } from '@/api/client'
import { readPublicToken } from '@/api/public'
import { AcceptInvite, readInviteLink } from '@/auth/AcceptInvite'
import { NoWorkspace } from '@/auth/NoWorkspace'
import { SignIn } from '@/auth/SignIn'
import { SettingsDialog } from '@/settings/SettingsDialog'
import { AboutButton } from '@/board/AboutButton'
import { GettingStarted } from '@/onboarding/GettingStarted'
import { UpdateBanner } from '@/board/UpdateBanner'
import { UpdatedNotice } from '@/board/UpdateProgress'
import { FocusCapsule } from '@/focus/FocusCapsule'
import { useFocusVisible } from '@/focus/store'
import { TopBar } from '@/board/TopBar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Home } from '@/home/Home'
import { goTo, takeFirstBoard, useAddressBoard, useRenameOnOpen } from '@/lib/navigation'
import { ERROR_MS } from '@/lib/toast'
import { startErrorReports } from '@/lib/errorReports'

const RELOADED = 'tiko.reloadedForChunk'

// A tab opened before an upgrade asks for a chunk the server no longer has; reload once to get the new build.
function reloadOnce(error: unknown): Promise<never> {
  try {
    if (!sessionStorage.getItem(RELOADED)) {
      sessionStorage.setItem(RELOADED, '1')
      window.location.reload()
      return new Promise(() => {})
    }
  } catch {
    // Storage blocked: fall through and show the error instead of looping.
  }
  throw error
}

// xyflow needs the DOM, so the canvas is loaded only in the browser, never in prerender.
const Canvas = lazy(() =>
  import('@/canvas/Canvas').then((module) => {
    try {
      sessionStorage.removeItem(RELOADED)
    } catch {
      // Storage blocked: nothing to clear.
    }
    return module
  }, reloadOnce),
)

// Loaded with the canvas, for the same reason.
const PublicBoard = lazy(() => import('@/public/PublicBoard'))

// Server snapshot is false, client snapshot is true: tells prerender and hydration apart.
const subscribeNever = () => () => {}

export default function App() {
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  const boardId = useAddressBoard()
  const renameOnOpen = useRenameOnOpen()
  const focusVisible = useFocusVisible()
  const [inviteLink] = useState(readInviteLink)
  // A public link is a page of its own: no sign-in, no boards of the person who opened it.
  const [publicToken] = useState(() => (typeof window === 'undefined' ? null : readPublicToken()))
  const queryClient = useQueryClient()
  const auth = useQuery({
    queryKey: ['auth'],
    queryFn: getAuthStatus,
    enabled: mounted && !publicToken,
  })
  const signedIn = auth.data?.signed_in === true
  const serverAdmin = auth.data?.me?.server_admin ?? false
  // Removed from the workspace: the account still signs in, but has no boards to open.
  const outside = signedIn && !!auth.data?.me && !auth.data.me.workspace
  const boards = useQuery({
    queryKey: ['boards'],
    queryFn: listBoards,
    enabled: mounted && signedIn && !outside,
    // Home shows other people's changes too: its previews follow a board within a minute.
    refetchInterval: boardId ? false : 30_000,
  })

  useEffect(() => {
    if (signedIn) void startErrorReports().catch(() => undefined)
  }, [signedIn])

  const mine = boards.data?.boards
  const others = boards.data?.all
  const current = boardId
    ? [...(mine ?? []), ...(others ?? [])].find((b) => b.id === boardId)
    : undefined
  // A board stays in the list while it is open; one that leaves it is gone for this person.
  const opened = useRef(new Set<string>())
  useEffect(() => {
    if (current) opened.current.add(current.id)
  }, [current])
  const missing = !!boardId && !!boards.data && !current && !boards.isFetching

  useEffect(() => {
    if (!missing || !boardId) return
    const text = opened.current.has(boardId)
      ? 'You no longer have access to this board.'
      : 'This board is not available.'
    // The canvas says the same with this id when it finds out first.
    toast(text, { id: 'board-lost', duration: ERROR_MS })
    goTo(null, { replace: true })
  }, [missing, boardId])

  useEffect(() => {
    if (mine?.length && takeFirstBoard()) goTo(mine[0].id)
  }, [mine])

  useEffect(() => {
    // Keeps what the answer says about the instance, like the demo switch.
    const signedOut = () =>
      queryClient.setQueryData(['auth'], (was: object | undefined) => ({
        ...was,
        signed_in: false,
        me: null,
      }))
    window.addEventListener(AUTH_REQUIRED_EVENT, signedOut)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, signedOut)
  }, [queryClient])

  if (mounted && publicToken) {
    return (
      <main className="bg-background relative h-dvh w-full overflow-hidden">
        <h1 className="sr-only">tiko</h1>
        <Suspense fallback={<Skeleton className="absolute inset-0 rounded-none" />}>
          <PublicBoard token={publicToken} />
        </Suspense>
      </main>
    )
  }

  if (mounted && inviteLink) {
    return (
      <main className="bg-background relative h-dvh w-full overflow-hidden">
        <h1 className="sr-only">tiko</h1>
        <AcceptInvite link={inviteLink} auth={auth} />
      </main>
    )
  }

  if (auth.data?.signed_in === false) {
    return (
      <main className="bg-background relative h-dvh w-full overflow-hidden">
        <h1 className="sr-only">tiko</h1>
        <SignIn demo={auth.data.demo} onSignedIn={() => void queryClient.invalidateQueries()} />
      </main>
    )
  }

  if (outside) {
    return (
      <main className="bg-background relative h-dvh w-full overflow-hidden">
        <h1 className="sr-only">tiko</h1>
        <NoWorkspace />
        {serverAdmin && <UpdateBanner />}
        <SettingsDialog />
      </main>
    )
  }

  const error = auth.error ?? boards.error

  return (
    <main className="bg-background relative h-dvh w-full overflow-hidden">
      <h1 className="sr-only">tiko</h1>
      {(!mounted || auth.isPending || (signedIn && boards.isPending)) && (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
      {error && (
        <Alert variant="destructive" className="absolute top-20 left-1/2 w-96 -translate-x-1/2">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      {current && (
        <Suspense fallback={<Skeleton className="absolute inset-0 rounded-none" />}>
          <Canvas key={current.id} boardId={current.id} />
        </Suspense>
      )}
      {mine && others && !boardId && <Home boards={mine} others={others} />}
      {mine && others && (!boardId || current) && (
        <TopBar boards={mine} others={others} current={current} renameOnOpen={renameOnOpen} />
      )}
      {signedIn && focusVisible && <FocusCapsule />}
      {signedIn && (
        <div className="absolute bottom-4 left-4 z-10 flex items-end gap-2">
          <AboutButton admin={serverAdmin} />
          <GettingStarted demo={!!auth.data?.me?.demo_expires_at} />
        </div>
      )}
      {signedIn && <UpdatedNotice />}
      {serverAdmin && <UpdateBanner />}
      {signedIn && <SettingsDialog />}
    </main>
  )
}
