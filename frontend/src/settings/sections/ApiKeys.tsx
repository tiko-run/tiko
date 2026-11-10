import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Plus } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import {
  createApiKey,
  daysLeft,
  listApiKeys,
  revokeApiKey,
  type ApiKey,
  type ApiKeyScope,
} from '@/api/apiKeys'
import { listBoards } from '@/api/boards'
import { ApiError } from '@/api/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { copyLink } from '@/lib/copy'
import { toastError } from '@/lib/toast'
import { SectionHeader } from '@/settings/sections/Section'

const API_KEYS = ['api-keys']

const SCOPE_NAMES: Record<ApiKeyScope, string> = { read: 'Read', write: 'Read and write' }
const SCOPES: ApiKeyScope[] = ['read', 'write']
const EXPIRY_DAYS = [7, 30, 90, 365]

const pad = (n: number) => String(n).padStart(2, '0')

/** "08.11.2026" in the person's time zone. */
function day(iso: string) {
  const d = new Date(iso)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

function expiry(key: ApiKey) {
  const days = daysLeft(key)
  if (days <= 0) return 'Expired'
  return `Expires in ${days} ${days === 1 ? 'day' : 'days'}`
}

function lastUsed(key: ApiKey) {
  if (!key.last_used_on) return 'Never used'
  // A plain day from the server, so it is not shifted by the time zone.
  const [year, month, date] = key.last_used_on.split('-')
  return `Last used ${date}.${month}.${year}`
}

function TokenBox({ token, onDone }: { token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const copy = async () => {
    if (await copyLink(token, field.current, 'key')) setCopied(true)
  }
  return (
    <div className="bg-accent/60 flex flex-col gap-2 rounded-md border p-3">
      <p className="text-[13px]">Copy this key now. It is not shown again.</p>
      <div className="flex gap-2">
        <Input
          ref={field}
          readOnly
          value={token}
          aria-label="Key"
          onFocus={(event) => event.target.select()}
          className="font-mono text-[12px]"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? <Check strokeWidth={1.75} /> : <Copy strokeWidth={1.75} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

function Choice({ value, id, label }: { value: string; id: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem value={value} id={id} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (token: string) => void
}) {
  const queryClient = useQueryClient()
  const boards = useQuery({ queryKey: ['boards'], queryFn: listBoards, enabled: open })
  const [name, setName] = useState('')
  const [scope, setScope] = useState<ApiKeyScope>('read')
  const [reach, setReach] = useState<'all' | 'chosen'>('all')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [days, setDays] = useState('90')
  const [password, setPassword] = useState('')
  const [wrongPassword, setWrongPassword] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () =>
      createApiKey({
        name: name.trim(),
        scope,
        boards: reach === 'all' ? null : [...chosen],
        days: Number(days),
        password,
      }),
    onSuccess: (created) => {
      onCreated(created.token)
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: API_KEYS })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'invalid_credentials') {
        setWrongPassword(error.message)
      } else toastError(error)
    },
  })
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const ready = name.trim() !== '' && password !== '' && (reach === 'all' || chosen.size > 0)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready) create.mutate()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              The key reaches what you can see on its boards, and the Planning they use: people,
              teams and days away. What it reads leaves tiko through whatever uses it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key-name">Name</Label>
            <Input
              id="api-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My agent"
              maxLength={60}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Access</span>
            <RadioGroup
              aria-label="Access"
              value={scope}
              onValueChange={(value) => setScope(value as ApiKeyScope)}
            >
              {SCOPES.map((item) => (
                <Choice
                  key={item}
                  value={item}
                  id={`api-key-scope-${item}`}
                  label={SCOPE_NAMES[item]}
                />
              ))}
            </RadioGroup>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Boards</span>
            <RadioGroup
              aria-label="Boards"
              value={reach}
              onValueChange={(value) => setReach(value as 'all' | 'chosen')}
            >
              <Choice value="all" id="api-key-boards-all" label="All my boards" />
              <Choice value="chosen" id="api-key-boards-chosen" label="Chosen boards" />
            </RadioGroup>
            {reach === 'chosen' && (
              <div className="max-h-48 overflow-y-auto rounded-md border p-1">
                {boards.isPending && (
                  <p className="text-muted-foreground p-1 text-[13px]">Loading boards…</p>
                )}
                {boards.isError && (
                  <p className="text-destructive p-1 text-[13px]">{boards.error.message}</p>
                )}
                {boards.isSuccess && boards.data.boards.length === 0 && (
                  <p className="text-muted-foreground p-1 text-[13px]">You have no boards yet.</p>
                )}
                <ul className="flex flex-col">
                  {boards.data?.boards.map((board) => (
                    <li key={board.id}>
                      <label className="hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-[13px]">
                        <Checkbox
                          checked={chosen.has(board.id)}
                          onCheckedChange={() => toggle(board.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">{board.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Expires in</span>
            <RadioGroup aria-label="Expires in" value={days} onValueChange={setDays}>
              {EXPIRY_DAYS.map((count) => (
                <Choice
                  key={count}
                  value={String(count)}
                  id={`api-key-days-${count}`}
                  label={`${count} days`}
                />
              ))}
            </RadioGroup>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key-password">Current password</Label>
            <Input
              id="api-key-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setWrongPassword(null)
              }}
              maxLength={1024}
              aria-invalid={wrongPassword !== null}
              required
            />
            {wrongPassword && <p className="text-destructive text-[13px]">{wrongPassword}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || create.isPending}>
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RevokeDialog({
  apiKey,
  onOpenChange,
}: {
  apiKey: ApiKey | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      toast.success(`${apiKey?.name} revoked`)
      onOpenChange(false)
    },
    onError: toastError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: API_KEYS }),
  })
  return (
    <Dialog open={apiKey !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Revoke {apiKey?.name}?</DialogTitle>
          <DialogDescription>
            Scripts and agents that use this key stop working. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => apiKey && revoke.mutate(apiKey.id)}
          >
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function KeyRow({ apiKey, onRevoke }: { apiKey: ApiKey; onRevoke: (key: ApiKey) => void }) {
  const boards =
    apiKey.boards === null
      ? 'All boards'
      : `${apiKey.boards.length} ${apiKey.boards.length === 1 ? 'board' : 'boards'}`
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{apiKey.name}</span>
        <span className="text-muted-foreground truncate text-[12px]">
          <span className="font-mono">tiko_{apiKey.prefix}…</span> · {boards} · Created{' '}
          {day(apiKey.created_at)} · {expiry(apiKey)} · {lastUsed(apiKey)}
        </span>
      </div>
      <Badge variant="secondary">{SCOPE_NAMES[apiKey.scope]}</Badge>
      <Button variant="ghost" size="sm" className="-mr-2.5" onClick={() => onRevoke(apiKey)}>
        Revoke
      </Button>
    </li>
  )
}

export function ApiKeys() {
  const keys = useQuery({ queryKey: API_KEYS, queryFn: listApiKeys })
  const [creating, setCreating] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="API keys"
        description="A key lets your scripts and your own AI agent read your boards, and with write access add to them. What the agent reads leaves tiko through that agent."
        action={
          keys.data?.enabled && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus strokeWidth={1.75} />
              New key
            </Button>
          )
        }
      />
      {token && <TokenBox token={token} onDone={() => setToken(null)} />}
      {keys.isPending && <p className="text-muted-foreground">Loading…</p>}
      {keys.isError && (
        <Alert variant="destructive">
          <AlertDescription>{keys.error.message}</AlertDescription>
        </Alert>
      )}
      {keys.isSuccess && (
        <>
          {!keys.data.enabled && (
            <p className="text-muted-foreground text-[13px]">
              Your admin has switched API keys off.
            </p>
          )}
          {keys.data.keys.length === 0 && keys.data.enabled && (
            <p className="text-muted-foreground text-[13px]">No keys yet.</p>
          )}
          {keys.data.keys.length > 0 && (
            <ul className="divide-y">
              {keys.data.keys.map((item) => (
                <KeyRow key={item.id} apiKey={item} onRevoke={setRevoking} />
              ))}
            </ul>
          )}
        </>
      )}
      {creating && <CreateDialog open onOpenChange={setCreating} onCreated={setToken} />}
      <RevokeDialog apiKey={revoking} onOpenChange={(open) => !open && setRevoking(null)} />
    </div>
  )
}
