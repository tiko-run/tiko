import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Ellipsis, UserPlus } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Me } from '@/api/auth'
import {
  changeRole,
  createInvite,
  listPeople,
  removePerson,
  revokeInvite,
  type Invite,
  type Person,
} from '@/api/people'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { copyLink } from '@/lib/copy'
import { toastError } from '@/lib/toast'
import { Group, SectionHeader } from '@/settings/sections/Section'
import { formatDue } from '@/timers/time'

const PEOPLE = ['people']

export type Link = { invite: Invite; url: string }

export function LinkBox({ link, onDone }: { link: Link; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const full = new URL(link.url, window.location.origin).toString()
  const what =
    link.invite.kind === 'invite'
      ? `Invite link for a new ${link.invite.role}.`
      : `Password reset link for ${link.invite.username}.`
  const field = useRef<HTMLInputElement>(null)
  const copy = async () => {
    if (await copyLink(full, field.current)) setCopied(true)
  }
  return (
    <div className="bg-accent/60 flex flex-col gap-2 rounded-md border p-3">
      <p className="text-[13px]">
        {what} Send it in a chat. It works once, until{' '}
        {formatDue(Date.parse(link.invite.expires_at))}, and is not shown again.
      </p>
      <div className="flex gap-2">
        <Input
          ref={field}
          readOnly
          value={full}
          aria-label="Link"
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

export function lastSeen(person: { last_sign_in_at: string | null }) {
  if (!person.last_sign_in_at) return 'Never signed in'
  return `Last signed in ${formatDue(Date.parse(person.last_sign_in_at))}`
}

function RemoveDialog({
  person,
  onOpenChange,
}: {
  person: Person | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: (id: string) => removePerson(id),
    onSuccess: () => {
      toast.success(`${person?.name} removed`)
      onOpenChange(false)
      // Their boards are the admin's now.
      void queryClient.invalidateQueries({ queryKey: ['boards'] })
    },
    onError: toastError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: PEOPLE }),
  })
  return (
    <Dialog open={person !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove {person?.name} from the workspace?</DialogTitle>
          <DialogDescription>
            They keep their account and can come back with an invite link. Boards they own move to
            you; their other members stay.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => person && remove.mutate(person.id)}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PersonRow({
  person,
  me,
  onRemove,
}: {
  person: Person
  me: Me
  onRemove: (person: Person) => void
}) {
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (role: Person['role']) => changeRole(person.id, role),
    onSuccess: (_, role) =>
      toast.success(`${person.name} is now ${role === 'admin' ? 'an admin' : 'a member'}`),
    onError: toastError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: PEOPLE }),
  })
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={person.disabled ? 'text-muted-foreground truncate' : 'truncate'}>
          <span className="font-medium">{person.name}</span>
          {person.id === me.id && <span className="text-muted-foreground"> (you)</span>}
        </span>
        <span className="text-muted-foreground truncate text-[12px]">
          {person.username} · {lastSeen(person)}
        </span>
      </div>
      {person.disabled && <Badge variant="outline">Disabled</Badge>}
      {person.role === 'admin' && <Badge variant="secondary">Admin</Badge>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Pulled out by its inner padding, so the dots line up with the Invite button. */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="-mr-1.5"
            aria-label={`Actions for ${person.name}`}
          >
            <Ellipsis strokeWidth={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => change.mutate(person.role === 'admin' ? 'member' : 'admin')}
          >
            {person.role === 'admin' ? 'Make member' : 'Make admin'}
          </DropdownMenuItem>
          {person.id !== me.id && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onRemove(person)}>
                Remove from workspace
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function InviteRow({ invite }: { invite: Invite }) {
  const queryClient = useQueryClient()
  const revoke = useMutation({
    mutationFn: () => revokeInvite(invite.id),
    onSuccess: () => toast.success('Link revoked'),
    onError: toastError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: PEOPLE }),
  })
  const what =
    invite.kind === 'invite' ? `Invite as ${invite.role}` : `Password reset for ${invite.username}`
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{what}</span>
        <span className="text-muted-foreground text-[12px]">
          Expires {formatDue(Date.parse(invite.expires_at))}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="-mr-2.5"
        onClick={() => revoke.mutate()}
        disabled={revoke.isPending}
      >
        Revoke
      </Button>
    </li>
  )
}

export function People({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const people = useQuery({ queryKey: PEOPLE, queryFn: listPeople })
  const [link, setLink] = useState<Link | null>(null)
  const [removing, setRemoving] = useState<Person | null>(null)
  const invite = useMutation({
    mutationFn: createInvite,
    onSuccess: (created) => {
      setLink(created)
      void queryClient.invalidateQueries({ queryKey: PEOPLE })
    },
    onError: toastError,
  })
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="People"
        description="Who works in this workspace. Invite people with a link; no mail needed."
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={invite.isPending}>
                <UserPlus strokeWidth={1.75} />
                Invite
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => invite.mutate('member')}>
                As member
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => invite.mutate('admin')}>As admin</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {link && <LinkBox link={link} onDone={() => setLink(null)} />}
      {people.isPending && <p className="text-muted-foreground">Loading…</p>}
      {people.isError && (
        <Alert variant="destructive">
          <AlertDescription>{people.error.message}</AlertDescription>
        </Alert>
      )}
      {people.isSuccess && (
        <>
          <ul className="divide-y">
            {people.data.people.map((person) => (
              <PersonRow key={person.id} person={person} me={me} onRemove={setRemoving} />
            ))}
          </ul>
          {people.data.invites.length > 0 && (
            <Group title="Open links">
              <ul className="divide-y">
                {people.data.invites.map((item) => (
                  <InviteRow key={item.id} invite={item} />
                ))}
              </ul>
            </Group>
          )}
        </>
      )}
      <RemoveDialog person={removing} onOpenChange={(open) => !open && setRemoving(null)} />
    </div>
  )
}
