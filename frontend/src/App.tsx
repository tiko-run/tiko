import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { getAuthStatus } from '@/api/auth'
import { listBoards } from '@/api/boards'
import { AUTH_REQUIRED_EVENT } from '@/api/client'
import { readPublicToken } from '@/api/public'
import { AcceptInvite, readInviteLink } from '@/auth/AcceptInvite'
import { SignIn } from '@/auth/SignIn'
import { SettingsDialog } from '@/settings/SettingsDialog'
import { NewBoardForm } from '@/board/NewBoardForm'
import { AboutButton } from '@/board/AboutButton'
import { UpdateBanner } from '@/board/UpdateBanner'
import { UpdatedNotice } from '@/board/UpdateProgress'
import { FocusCapsule } from '@/focus/FocusCapsule'
import { useFocusVisible } from '@/focus/store'
import { TopBar } from '@/board/TopBar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'

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

const LAST_BOARD = 'tiko.lastBoard'

// Server snapshot is false, client snapshot is true: tells prerender and hydration apart.
const subscribeNever = () => () => {}

function readBoardId(): string | null {
  return (
    new URLSearchParams(window.location.search).get('board') ?? localStorage.getItem(LAST_BOARD)
  )
}

function rememberBoard(id: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('board', id)
  window.history.replaceState(null, '', url)
  localStorage.setItem(LAST_BOARD, id)
}

export default function App() {
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  const [boardId, setBoardId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readBoardId(),
  )
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
  const admin = auth.data?.me?.role === 'admin'
  const boards = useQuery({
    queryKey: ['boards'],
    queryFn: listBoards,
    enabled: mounted && signedIn,
  })

  const mine = boards.data?.boards
  const known = [...(mine ?? []), ...(boards.data?.all ?? [])].find((b) => b.id === boardId)
  const current = known ?? mine?.[0]

  useEffect(() => {
    if (current) rememberBoard(current.id)
  }, [current])

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
        <AcceptInvite link={inviteLink} />
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
      {mine?.length === 0 && !current && (
        <div className="absolute top-1/2 left-1/2 flex w-96 -translate-x-1/2 -translate-y-1/2 flex-col gap-3">
          <p className="text-[14px]">Create a board to start placing tasks on it.</p>
          <NewBoardForm onCreated={setBoardId} autoFocus />
        </div>
      )}
      {current && (
        <Suspense fallback={<Skeleton className="absolute inset-0 rounded-none" />}>
          <Canvas key={current.id} boardId={current.id} />
        </Suspense>
      )}
      {boards.data && (
        <TopBar
          boards={boards.data.boards}
          others={boards.data.all}
          current={current}
          onSelect={setBoardId}
        />
      )}
      {focusVisible && <FocusCapsule />}
      {signedIn && <AboutButton admin={admin} />}
      {signedIn && <UpdatedNotice />}
      {admin && <UpdateBanner />}
      {signedIn && <SettingsDialog />}
    </main>
  )
}
