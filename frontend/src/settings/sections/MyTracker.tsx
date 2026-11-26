import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import {
  getTracker,
  removeTrackerToken,
  saveTrackerToken,
  testJira,
  type Tracker,
} from '@/api/settings'
import { choosePrefix, forgetPrefix, getPrefixChoices } from '@/api/tasks'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toastError } from '@/lib/toast'
import { CalDavForm } from '@/settings/sections/CalDavForm'
import { SectionHeader } from '@/settings/sections/Section'
import { didOnboarding } from '@/onboarding/done'
import { SourceMark } from '@/sources/SourceMark'
import { TOKEN_SOURCES, sourceLabel } from '@/sources/registry'

const ATLASSIAN_TOKENS = 'https://id.atlassian.com/manage-profile/security/api-tokens'

type TokenSourceForm = (typeof TOKEN_SOURCES)[number]

const SOURCE_HINT = {
  set: 'Your token is stored. Enter a new one to replace it.',
  unreadable: 'Your stored token no longer works here: the secret key changed. Enter it again.',
}

const HINT = {
  none: 'No token yet. Cards show only their keys until you connect one.',
  set: 'Your token is stored. Enter a new one to replace it.',
  unreadable:
    'Your stored token no longer works here: the Jira URL or the secret key changed. Enter it again.',
}

// Cards and searches go through the person's token, so open boards read again.
function useTokenChanged() {
  const queryClient = useQueryClient()
  return (next?: Tracker) => {
    if (next) {
      queryClient.setQueryData(['tracker'], next)
      didOnboarding('tracker')
    } else void queryClient.invalidateQueries({ queryKey: ['tracker'] })
    void queryClient.invalidateQueries({ queryKey: ['settings'] })
    void queryClient.invalidateQueries({ queryKey: ['board'] })
    void queryClient.invalidateQueries({ queryKey: ['refresh'] })
  }
}

function SourceTokenForm({ tracker, source }: { tracker: Tracker; source: TokenSourceForm }) {
  const [token, setToken] = useState('')
  const changed = useTokenChanged()
  const state = tracker.tokens[source.id] ?? 'none'
  const save = useMutation({
    mutationFn: () => saveTrackerToken(token.trim(), source.id),
    onSuccess: (next) => {
      setToken('')
      changed(next)
      toast.success('Token saved')
    },
  })
  const remove = useMutation({
    mutationFn: () => removeTrackerToken(source.id),
    onSuccess: () => {
      changed()
      toast.success('Token removed')
    },
    onError: toastError,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }
  const field = `${source.id}-token`
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-muted-foreground text-[13px]">
        {source.intro}{' '}
        <a
          href={source.guide}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          {source.guideLabel}
        </a>
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={field}>{source.label}</Label>
        <Input
          id={field}
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
        />
        <p className="text-muted-foreground text-[13px]">
          {state === 'none' ? source.none : SOURCE_HINT[state]} It stays on the server and is never
          shown again.
        </p>
      </div>
      {save.isError && <p className="text-destructive text-[13px]">{save.error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={save.isPending || !token.trim()}>
          Save {source.label}
        </Button>
        {state !== 'none' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove {source.label}
          </Button>
        )}
      </div>
    </form>
  )
}

function TokenForm({ tracker }: { tracker: Tracker }) {
  const cloud = tracker.kind === 'cloud'
  const jiraState = tracker.tokens.jira ?? 'none'
  const [token, setToken] = useState('')
  const [email, setEmail] = useState(tracker.email ?? '')
  const changed = useTokenChanged()
  const save = useMutation({
    mutationFn: () => saveTrackerToken(token.trim(), 'jira', cloud ? email.trim() : undefined),
    onSuccess: (next) => {
      setToken('')
      changed(next)
      toast.success('Token saved')
    },
  })
  const remove = useMutation({
    mutationFn: () => removeTrackerToken(),
    onSuccess: () => {
      changed()
      toast.success('Token removed')
    },
    onError: toastError,
  })
  const test = useMutation({
    mutationFn: () =>
      testJira({
        ...(token.trim() && { token: token.trim() }),
        ...(cloud && email.trim() && { email: email.trim() }),
      }),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tracker-url">Jira URL</Label>
        <Input id="tracker-url" value={tracker.base_url ?? ''} readOnly disabled />
        <p className="text-muted-foreground text-[13px]">Set by an admin for everyone.</p>
      </div>
      {cloud && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tracker-email">Atlassian account e-mail</Label>
          <Input
            id="tracker-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            spellCheck={false}
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tracker-token">{cloud ? 'API token' : 'Personal access token'}</Label>
        <Input
          id="tracker-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
        />
        <p className="text-muted-foreground text-[13px]">
          {HINT[jiraState]} It stays on the server and is never shown again.
          {cloud && (
            <>
              {' '}
              <a
                href={ATLASSIAN_TOKENS}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Create an API token
              </a>{' '}
              without scopes.
            </>
          )}
        </p>
      </div>
      {save.isError && <p className="text-destructive text-[13px]">{save.error.message}</p>}
      {test.isError && <p className="text-destructive text-[13px]">{test.error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={save.isPending || !token.trim() || (cloud && !email.trim())}
        >
          Save token
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={test.isPending || (!token.trim() && jiraState !== 'set')}
          onClick={() => test.mutate()}
        >
          Test connection
        </Button>
        {jiraState !== 'none' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove token
          </Button>
        )}
        {test.isSuccess && (
          <span className="text-status-done-foreground text-[13px]">
            Connected as {test.data.user}
          </span>
        )}
      </div>
    </form>
  )
}

/** The remembered answers of the prefix dialog: where a bare key with each prefix goes. */
function KeyPrefixes({ provider }: { provider: string }) {
  // A bare key is either the instance's tracker's or Linear's.
  const options = [provider, 'linear']
  const queryClient = useQueryClient()
  const choices = useQuery({ queryKey: ['key-prefixes'], queryFn: getPrefixChoices })
  const change = useMutation({
    mutationFn: ({ prefix, source }: { prefix: string; source: string | null }) =>
      source ? choosePrefix(prefix, source) : forgetPrefix(prefix).then(() => null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['key-prefixes'] }),
    onError: toastError,
  })
  const list = choices.data?.choices ?? []
  if (list.length === 0) return null
  return (
    <fieldset>
      <legend className="mb-2 font-medium">Key prefixes</legend>
      <p className="text-muted-foreground mb-3 text-[13px]">
        A bare key like ENG-12 goes to the tracker that knows its prefix. When two of yours know it,
        tiko asks once and remembers your answer here.
      </p>
      <ul className="flex flex-col gap-2">
        {list.map(({ prefix, source }) => (
          <li key={prefix} className="flex items-center gap-2">
            <span className="w-24 truncate font-mono text-[13px]">{prefix}</span>
            <div role="radiogroup" aria-label={`Tracker for ${prefix}`} className="flex gap-1">
              {options.map((option) => (
                <Button
                  key={option}
                  role="radio"
                  aria-checked={option === source}
                  size="sm"
                  variant={option === source ? 'secondary' : 'ghost'}
                  disabled={change.isPending}
                  onClick={() => option !== source && change.mutate({ prefix, source: option })}
                >
                  <SourceMark source={option} />
                  {sourceLabel(option)}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={change.isPending}
              onClick={() => change.mutate({ prefix, source: null })}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}

export function MyTracker() {
  const tracker = useQuery({ queryKey: ['tracker'], queryFn: getTracker })
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="My tracker"
        description="Your own tokens and accounts. Cards show you only what your access allows."
      />
      {tracker.isPending && <p className="text-muted-foreground">Loading…</p>}
      {tracker.isError && (
        <Alert variant="destructive">
          <AlertDescription>{tracker.error.message}</AlertDescription>
        </Alert>
      )}
      {tracker.data?.provider === 'demo' && (
        <p className="text-muted-foreground text-[13px]">
          This tiko uses demo tasks, which need no token.
        </p>
      )}
      {tracker.data?.provider === 'jira' && (
        <fieldset>
          <legend className="mb-2 font-medium">Jira</legend>
          {tracker.data.base_url ? (
            <TokenForm tracker={tracker.data} />
          ) : (
            <p className="text-muted-foreground text-[13px]">
              An admin sets the Jira URL in Task source first.
            </p>
          )}
        </fieldset>
      )}
      {tracker.data &&
        TOKEN_SOURCES.map((source) => (
          <fieldset key={source.id}>
            <legend className="mb-2 font-medium">{source.name}</legend>
            <SourceTokenForm tracker={tracker.data} source={source} />
          </fieldset>
        ))}
      {tracker.data && (
        <fieldset>
          <legend className="mb-2 font-medium">CalDAV</legend>
          <CalDavForm />
        </fieldset>
      )}
      {tracker.data && <KeyPrefixes provider={tracker.data.provider} />}
    </div>
  )
}
