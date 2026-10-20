import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ellipsis } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { createResetLink, listAccounts, setDisabled, type Account } from '@/api/accounts'
import type { Me } from '@/api/auth'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toastError } from '@/lib/toast'
import { LinkBox, lastSeen, type Link } from '@/settings/sections/People'
import { SectionHeader } from '@/settings/sections/Section'

const ACCOUNTS = ['accounts']

function AccountRow({
  account,
  me,
  onLink,
}: {
  account: Account
  me: Me
  onLink: (link: Link) => void
}) {
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ACCOUNTS })
    // A reset link shows among the open links of People too.
    void queryClient.invalidateQueries({ queryKey: ['people'] })
  }
  const toggle = useMutation({
    mutationFn: () => setDisabled(account.id, !account.disabled),
    onSuccess: (changed) =>
      toast.success(`${account.name} ${changed.disabled ? 'disabled' : 'enabled'}`),
    onError: toastError,
    onSettled: refresh,
  })
  const reset = useMutation({
    mutationFn: () => createResetLink(account.id),
    onSuccess: (link) => {
      onLink(link)
      refresh()
    },
    onError: toastError,
  })
  const self = account.id === me.id
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={account.disabled ? 'text-muted-foreground truncate' : 'truncate'}>
          <span className="font-medium">{account.name}</span>
          {self && <span className="text-muted-foreground"> (you)</span>}
        </span>
        <span className="text-muted-foreground truncate text-[12px]">
          {account.username} · {lastSeen(account)}
        </span>
      </div>
      {!account.in_workspace && <Badge variant="outline">No workspace</Badge>}
      {account.disabled && <Badge variant="outline">Disabled</Badge>}
      {account.server_admin && <Badge variant="secondary">Server admin</Badge>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="-mr-1.5"
            aria-label={`Actions for ${account.name}`}
          >
            <Ellipsis strokeWidth={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => reset.mutate()}>Reset password</DropdownMenuItem>
          {/* The server keeps its admin: they cannot disable themselves. */}
          {!self && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant={account.disabled ? 'default' : 'destructive'}
                onSelect={() => toggle.mutate()}
              >
                {account.disabled ? 'Enable' : 'Disable'}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

export function Accounts({ me }: { me: Me }) {
  const accounts = useQuery({ queryKey: ACCOUNTS, queryFn: listAccounts })
  const [link, setLink] = useState<Link | null>(null)
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Accounts"
        description="Everyone who can sign in to this server. A disabled account cannot sign in; a reset link sets a new password."
      />
      {link && <LinkBox link={link} onDone={() => setLink(null)} />}
      {accounts.isPending && <p className="text-muted-foreground">Loading…</p>}
      {accounts.isError && (
        <Alert variant="destructive">
          <AlertDescription>{accounts.error.message}</AlertDescription>
        </Alert>
      )}
      {accounts.isSuccess && (
        <ul className="divide-y">
          {accounts.data.accounts.map((account) => (
            <AccountRow key={account.id} account={account} me={me} onLink={setLink} />
          ))}
        </ul>
      )}
    </div>
  )
}
