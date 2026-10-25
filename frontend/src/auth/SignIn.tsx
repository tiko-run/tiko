import { useMutation } from '@tanstack/react-query'
import { LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
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
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation({
    mutationFn: signIn,
    onSuccess: (_, credentials) => {
      rememberSignIn(credentials.password)
      onSignedIn()
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (username && password) login.mutate({ username: username.trim(), password })
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
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          maxLength={64}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sign-in-password">Password</Label>
        <Input
          id="sign-in-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          maxLength={1024}
        />
      </div>
      <Button type="submit" disabled={login.isPending || !username || !password}>
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
