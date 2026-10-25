import { useMutation } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { changePassword, signOut } from '@/api/auth'
import { ApiError } from '@/api/client'
import { Emblem } from '@/components/Emblem'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// The password just typed on the sign-in screen, kept in memory only, so the first admin is
// not asked for it twice. A reload forgets it and the form asks for it.
let signedInWith: string | null = null

export function rememberSignIn(password: string) {
  signedInWith = password
}

function message(error: Error) {
  if (error instanceof ApiError && error.code === 'invalid_credentials')
    return 'The current password is wrong.'
  return error.message
}

/** The first admin's only screen until they replace the password from the log or a file. */
export function NewPassword({ username, onDone }: { username: string; onDone: () => void }) {
  const [current, setCurrent] = useState(signedInWith ?? '')
  const askCurrent = signedInWith === null
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const change = useMutation({
    mutationFn: () => changePassword({ current, new: next }),
    onSuccess: () => {
      signedInWith = null
      onDone()
    },
  })
  const leave = useMutation({ mutationFn: signOut, onSettled: onDone })
  const mismatch = again.length > 0 && again !== next
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!mismatch) change.mutate()
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
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-medium">Set your own password</h2>
        <p className="text-muted-foreground text-[13px]">
          The password you signed in with sits in a log, a file or a hosting variable. Pick a new
          one to open tiko.
        </p>
      </div>
      {/* Lets password managers file the new password under the right account. */}
      <input type="text" value={username} autoComplete="username" readOnly hidden />
      {askCurrent && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="first-current">Current password</Label>
          <Input
            id="first-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value)
              change.reset()
            }}
            maxLength={1024}
            required
            autoFocus
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="first-new">New password</Label>
        <Input
          id="first-new"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => {
            setNext(event.target.value)
            change.reset()
          }}
          minLength={10}
          maxLength={1024}
          required
          autoFocus={!askCurrent}
        />
        <p className="text-muted-foreground text-[13px]">At least 10 characters.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="first-again">Repeat the new password</Label>
        <Input
          id="first-again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => {
            setAgain(event.target.value)
            change.reset()
          }}
          maxLength={1024}
          required
          aria-invalid={mismatch || undefined}
        />
        {mismatch && <p className="text-destructive text-[13px]">The passwords do not match.</p>}
      </div>
      <Button type="submit" disabled={change.isPending || mismatch || !next || !again}>
        <KeyRound strokeWidth={1.75} />
        Set password
      </Button>
      {change.isError && <p className="text-destructive text-sm">{message(change.error)}</p>}
      <Button
        type="button"
        variant="link"
        className="text-muted-foreground h-auto self-center p-0 text-[13px]"
        onClick={() => leave.mutate()}
        disabled={leave.isPending}
      >
        Sign out
      </Button>
    </form>
  )
}
