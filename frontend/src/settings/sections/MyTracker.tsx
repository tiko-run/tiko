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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toastError } from '@/lib/toast'
import { SectionHeader } from '@/settings/sections/Section'
import { didOnboarding } from '@/onboarding/done'

const GITHUB_GUIDE = 'https://docs.tiko.run/github-issues/#your-own-token'

const GITHUB_HINT = {
  none: 'No token yet. Public issues and pull requests work without one.',
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

function GitHubTokenForm({ tracker }: { tracker: Tracker }) {
  const [token, setToken] = useState('')
  const changed = useTokenChanged()
  const save = useMutation({
    mutationFn: () => saveTrackerToken(token.trim(), 'github'),
    onSuccess: (next) => {
      setToken('')
      changed(next)
      toast.success('Token saved')
    },
  })
  const remove = useMutation({
    mutationFn: () => removeTrackerToken('github'),
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
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-muted-foreground text-[13px]">
        With your own token you see issues and pull requests of private repositories it can read,
        and your GitHub cards refresh on your own request limit. Other people on a board see a
        private task only with a token of their own. A fine-grained token needs the repositories
        picked and read-only access to Issues and Pull requests.{' '}
        <a
          href={GITHUB_GUIDE}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          Which token to create
        </a>
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="github-token">GitHub token</Label>
        <Input
          id="github-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
        />
        <p className="text-muted-foreground text-[13px]">
          {GITHUB_HINT[tracker.github_token_state]} It stays on the server and is never shown again.
        </p>
      </div>
      {save.isError && <p className="text-destructive text-[13px]">{save.error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={save.isPending || !token.trim()}>
          Save GitHub token
        </Button>
        {tracker.github_token_state !== 'none' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove GitHub token
          </Button>
        )}
      </div>
    </form>
  )
}

function TokenForm({ tracker }: { tracker: Tracker }) {
  const [token, setToken] = useState('')
  const changed = useTokenChanged()
  const save = useMutation({
    mutationFn: () => saveTrackerToken(token.trim()),
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
    mutationFn: () => testJira(token.trim() ? { token: token.trim() } : {}),
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tracker-token">Personal access token</Label>
        <Input
          id="tracker-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
        />
        <p className="text-muted-foreground text-[13px]">
          {HINT[tracker.token_state]} It stays on the server and is never shown again.
        </p>
      </div>
      {save.isError && <p className="text-destructive text-[13px]">{save.error.message}</p>}
      {test.isError && <p className="text-destructive text-[13px]">{test.error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={save.isPending || !token.trim()}>
          Save token
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={test.isPending || (!token.trim() && tracker.token_state !== 'set')}
          onClick={() => test.mutate()}
        >
          Test connection
        </Button>
        {tracker.token_state !== 'none' && (
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

export function MyTracker() {
  const tracker = useQuery({ queryKey: ['tracker'], queryFn: getTracker })
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="My tracker"
        description="Your own tokens. Cards show you only what your access allows."
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
      {tracker.data && (
        <fieldset>
          <legend className="mb-2 font-medium">GitHub</legend>
          <GitHubTokenForm tracker={tracker.data} />
        </fieldset>
      )}
    </div>
  )
}
