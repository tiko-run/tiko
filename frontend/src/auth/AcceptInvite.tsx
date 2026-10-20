import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ComponentProps, type FormEvent } from 'react'
import { signOut, type Me } from '@/api/auth'
import { acceptInvite, joinInvite, openInvite, type InviteInfo } from '@/api/people'
import { SignIn } from '@/auth/SignIn'
import { Emblem } from '@/components/Emblem'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type InviteLink = { kind: 'invite' | 'reset'; token: string }

type Auth = { isPending: boolean; data?: { signed_in: boolean; me: Me | null } }

/** `?invite=<token>` or `?reset=<token>` from the address, if the page was opened by a link. */
export function readInviteLink(): InviteLink | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const invite = params.get('invite')
  if (invite) return { kind: 'invite', token: invite }
  const reset = params.get('reset')
  return reset ? { kind: 'reset', token: reset } : null
}

// A full load drops whatever session and cache the browser had before the link.
function leave() {
  const url = new URL(window.location.href)
  url.searchParams.delete('invite')
  url.searchParams.delete('reset')
  window.location.replace(url)
}

function Field({
  id,
  label,
  hint,
  ...props
}: { id: string; label: string; hint?: string } & ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
      {hint && <p className="text-muted-foreground text-[13px]">{hint}</p>}
    </div>
  )
}

function asRole(info: InviteInfo) {
  return info.role === 'admin' ? ' as an admin' : ''
}

/** Signed in already: the invite takes the account the person has. */
function JoinForm({ token, info, me }: { token: string; info: InviteInfo; me: Me }) {
  const queryClient = useQueryClient()
  const join = useMutation({ mutationFn: () => joinInvite(token), onSuccess: leave })
  const other = useMutation({
    mutationFn: signOut,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth'] }),
  })
  if (me.workspace) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[14px]">You are already in a workspace.</p>
        <div>
          <Button variant="outline" size="sm" onClick={leave}>
            Open tiko
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-[14px]">
        You are invited to a workspace{asRole(info)}. Join as {me.name}?
      </p>
      <Button disabled={join.isPending} onClick={() => join.mutate()}>
        Join
      </Button>
      {join.isError && <p className="text-destructive text-sm">{join.error.message}</p>}
      <p className="text-muted-foreground text-center text-[13px]">
        Not {me.name}?{' '}
        <Button
          variant="link"
          className="h-auto p-0 text-[13px]"
          disabled={other.isPending}
          onClick={() => other.mutate()}
        >
          Sign out
        </Button>
      </p>
    </div>
  )
}

function AcceptForm({
  token,
  info,
  onSignIn,
}: {
  token: string
  info: InviteInfo
  onSignIn: () => void
}) {
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const isInvite = info.kind === 'invite'
  const accept = useMutation({
    mutationFn: () =>
      acceptInvite(
        token,
        isInvite ? { username: username.trim(), name: name.trim(), password } : { password },
      ),
    onSuccess: leave,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    accept.mutate()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-muted-foreground text-[14px]">
        {isInvite
          ? `You are invited to tiko${asRole(info)}. Pick how you sign in.`
          : `Set a new password for ${info.username}.`}
      </p>
      {isInvite && (
        <>
          <Field
            id="invite-name"
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={64}
            required
            autoFocus
          />
          <Field
            id="invite-username"
            label="Username"
            hint="Letters, digits, dot, dash and underscore."
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            minLength={3}
            maxLength={32}
            required
          />
        </>
      )}
      {!isInvite && (
        <input type="text" value={info.username ?? ''} autoComplete="username" readOnly hidden />
      )}
      <Field
        id="invite-password"
        label={isInvite ? 'Password' : 'New password'}
        hint="At least 10 characters."
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        minLength={10}
        maxLength={1024}
        required
        autoFocus={!isInvite}
      />
      <Button type="submit" disabled={accept.isPending}>
        {isInvite ? 'Join tiko' : 'Set password'}
      </Button>
      {accept.isError && <p className="text-destructive text-sm">{accept.error.message}</p>}
      {isInvite && (
        <p className="text-muted-foreground text-center text-[13px]">
          Already have an account?{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-[13px]"
            onClick={onSignIn}
          >
            Sign in
          </Button>
        </p>
      )}
    </form>
  )
}

/** The page an invite or password reset link opens, before or instead of signing in. */
export function AcceptInvite({ link, auth }: { link: InviteLink; auth: Auth }) {
  const queryClient = useQueryClient()
  const [signingIn, setSigningIn] = useState(false)
  const info = useQuery({
    queryKey: ['invite', link.token],
    queryFn: () => openInvite(link.token),
    retry: false,
  })
  const me = auth.data?.signed_in ? auth.data.me : null
  if (signingIn && !me) {
    return (
      <SignIn
        onSignedIn={() => {
          setSigningIn(false)
          void queryClient.invalidateQueries({ queryKey: ['auth'] })
        }}
      />
    )
  }
  const invite = info.data?.kind === 'invite'
  return (
    <div className="absolute top-1/2 left-1/2 flex w-80 -translate-x-1/2 -translate-y-1/2 flex-col gap-4">
      <p className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.03em]">
        <Emblem className="size-6" />
        tiko
      </p>
      {(info.isPending || (invite && auth.isPending)) && (
        <p className="text-muted-foreground text-[14px]">Checking the link…</p>
      )}
      {info.isError && (
        <div className="flex flex-col gap-3">
          <p className="text-[14px]">{info.error.message}</p>
          <div>
            <Button variant="outline" size="sm" onClick={leave}>
              Go to sign in
            </Button>
          </div>
        </div>
      )}
      {info.isSuccess && invite && me && <JoinForm token={link.token} info={info.data} me={me} />}
      {info.isSuccess && (!invite || (!auth.isPending && !me)) && (
        <AcceptForm token={link.token} info={info.data} onSignIn={() => setSigningIn(true)} />
      )}
    </div>
  )
}
