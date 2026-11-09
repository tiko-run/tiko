import { useMutation } from '@tanstack/react-query'
import { LogIn } from 'lucide-react'
import type { FormEvent } from 'react'
import { ApiError } from '@/api/client'
import { signIn } from '@/api/auth'
import { DemoStart } from '@/auth/DemoStart'
import { rememberSignIn } from '@/auth/NewPassword'
import { Emblem } from '@/components/Emblem'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { openFirstBoard } from '@/lib/navigation'

const FIRST_PASSWORD_GUIDE = 'https://docs.tiko.run/security/#the-first-password'

function message(error: Error) {
  if (!(error instanceof ApiError)) return error.message
  if (error.code === 'invalid_credentials') return 'Wrong username or password.'
  if (error.code === 'account_disabled') return 'This account is disabled. Ask your admin.'
  if (error.code === 'too_many_attempts')
    return `Too many wrong passwords. Try again in ${error.retryAfter ?? 60} s.`
  return error.message
}

export function SignIn({ onSignedIn, demo = false }: { onSignedIn: () => void; demo?: boolean }) {
  const login = useMutation({
    mutationFn: signIn,
    onSuccess: (_, credentials) => {
      rememberSignIn(credentials.password)
      onSignedIn()
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    // Read from the fields: browser autofill shows values that no change event has reported yet.
    const form = new FormData(event.currentTarget as HTMLFormElement)
    const username = String(form.get('username') ?? '').trim()
    const password = String(form.get('password') ?? '')
    if (username && password) login.mutate({ username, password })
  }
  // The demo button has an address of its own; everything else is the sign-in form.
  if (demo && /^\/demo\/?$/.test(window.location.pathname)) {
    const started = () => {
      // Home takes the button's place, so a reload or Back never lands on it again.
      window.history.replaceState(null, '', '/')
      openFirstBoard()
      onSignedIn()
    }
    return <DemoStart onStarted={started} />
  }
  return (
    <form
      onSubmit={submit}
      className="absolute top-1/2 left-1/2 flex w-80 -translate-x-1/2 -translate-y-1/2 flex-col gap-3"
    >
      <p className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.03em]">
        <Emblem className="size-6" />
        tiko
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sign-in-username">Username</Label>
        <Input
          id="sign-in-username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={64}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sign-in-password">Password</Label>
        <Input
          id="sign-in-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={1024}
        />
      </div>
      <Button type="submit" disabled={login.isPending}>
        <LogIn strokeWidth={1.75} />
        Sign in
      </Button>
      {login.isError && <p className="text-destructive text-sm">{message(login.error)}</p>}
      {!demo && (
        <p className="text-muted-foreground mt-2 text-center text-[13px]">
          <Button asChild variant="link" className="h-auto p-0 text-[13px]">
            <a href={FIRST_PASSWORD_GUIDE} target="_blank" rel="noreferrer">
              First time here?
            </a>
          </Button>
        </p>
      )}
      {demo && (
        <p className="text-muted-foreground mt-2 text-center text-[13px]">
          Just looking?{' '}
          <Button asChild variant="link" className="h-auto p-0 text-[13px]">
            <a href="/demo">Try the demo</a>
          </Button>
        </p>
      )}
    </form>
  )
}
