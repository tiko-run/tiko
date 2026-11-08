import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import {
  connectCalDav,
  getCalDav,
  getCalDavLists,
  hideCalDavLists,
  removeCalDav,
  type CalDavAccount,
  type TaskList,
} from '@/api/caldav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toastError } from '@/lib/toast'

const CALDAV_GUIDE = 'https://docs.tiko.run/caldav/'

function normalized(address: string) {
  const text = address.trim().replace(/\/+$/, '')
  return text.includes('://') ? text : `https://${text}`
}

const HINT = {
  none: 'Not connected. CalDAV cards show only their list until you connect.',
  set: 'Your password is stored. Leave it blank to keep it, unless you change the address or user name.',
  unreadable: 'Your stored account no longer works here: the secret key changed. Enter it again.',
}

// Cards and the card tool read through the person's account, so open boards read again.
function useAccountChanged() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['caldav'] })
    void queryClient.invalidateQueries({ queryKey: ['board'] })
    void queryClient.invalidateQueries({ queryKey: ['refresh'] })
  }
}

function ListSwitches() {
  const queryClient = useQueryClient()
  const lists = useQuery({ queryKey: ['caldav', 'lists'], queryFn: getCalDavLists })
  const hide = useMutation({
    mutationFn: hideCalDavLists,
    onSuccess: (next) => queryClient.setQueryData(['caldav', 'lists'], next),
    onError: toastError,
  })
  if (lists.isPending) return <p className="text-muted-foreground text-[13px]">Loading lists…</p>
  if (lists.isError) return <p className="text-destructive text-[13px]">{lists.error.message}</p>
  const toggle = (list: TaskList, shown: boolean) => {
    const hidden = lists.data.filter((l) => (l.id === list.id ? !shown : !l.shown)).map((l) => l.id)
    hide.mutate(hidden)
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-[13px]">
        Task lists in the card tool. Lists switched off stay hidden.
      </p>
      <ul className="flex flex-col gap-1.5">
        {lists.data.map((list) => (
          <li key={list.id} className="flex items-center gap-2">
            <Switch
              id={`caldav-list-${list.id}`}
              checked={list.shown}
              disabled={hide.isPending}
              onCheckedChange={(shown) => toggle(list, shown)}
            />
            <Label htmlFor={`caldav-list-${list.id}`} className="font-normal">
              {list.color && (
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: `#${list.color}` }}
                />
              )}
              {list.name}
            </Label>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AccountForm({ account }: { account: CalDavAccount }) {
  const [address, setAddress] = useState(account.address ?? '')
  const [username, setUsername] = useState(account.username ?? '')
  const [password, setPassword] = useState('')
  const changed = useAccountChanged()
  const save = useMutation({
    mutationFn: () =>
      connectCalDav({
        address: address.trim(),
        username: username.trim(),
        ...(password.trim() && { password: password.trim() }),
      }),
    onSuccess: (next) => {
      setPassword('')
      changed()
      toast.success(`Connected as ${next.display_name}`)
    },
  })
  const remove = useMutation({
    mutationFn: removeCalDav,
    onSuccess: () => {
      setPassword('')
      changed()
      toast.success('CalDAV account removed')
    },
    onError: toastError,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }
  // A stored password goes only to the address and user name it was typed for.
  const same =
    account.state === 'set' &&
    normalized(address) === normalized(account.address ?? '') &&
    username.trim() === account.username
  const needsPassword = !same && !password.trim()
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-muted-foreground text-[13px]">
        Tasks from Nextcloud, Radicale or another CalDAV server, including the ones you add in
        Thunderbird or Apple Reminders. tiko only reads them.{' '}
        <a
          href={CALDAV_GUIDE}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          How to connect
        </a>
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="caldav-address">Server address</Label>
        <Input
          id="caldav-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="cloud.example.com"
          autoComplete="url"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="caldav-username">User name</Label>
        <Input
          id="caldav-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="caldav-password">App password</Label>
        <Input
          id="caldav-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="off"
        />
        <p className="text-muted-foreground text-[13px]">
          {HINT[account.state]} tiko stores it encrypted and never shows it again.
        </p>
      </div>
      {save.isError && <p className="text-destructive text-[13px]">{save.error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={save.isPending || !address.trim() || !username.trim() || needsPassword}
        >
          {save.isPending ? 'Connecting…' : 'Connect'}
        </Button>
        {account.state !== 'none' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove account
          </Button>
        )}
      </div>
      {account.state === 'set' && <ListSwitches />}
    </form>
  )
}

export function CalDavForm() {
  const account = useQuery({ queryKey: ['caldav'], queryFn: getCalDav })
  if (account.isPending) return <p className="text-muted-foreground">Loading…</p>
  if (account.isError)
    return <p className="text-destructive text-[13px]">{account.error.message}</p>
  // Keyed by the stored account, so the fields follow a removal or a new connection.
  return (
    <AccountForm
      key={`${account.data.state}:${account.data.address}:${account.data.username}`}
      account={account.data}
    />
  )
}
