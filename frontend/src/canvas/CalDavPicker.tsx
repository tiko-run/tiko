import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useState } from 'react'
import { findCalDavTasks, getCalDav, getCalDavLists, type TaskList } from '@/api/caldav'
import type { Task } from '@/api/tasks'
import { errorMessage } from '@/canvas/refs'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useDebounced } from '@/lib/useDebounced'
import { cn } from '@/lib/utils'

const SEARCH_DELAY_MS = 300
const ALL = 'all'

function Dot({ color }: { color: string }) {
  if (!color) return null
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: `#${color}` }}
    />
  )
}

function account(address: string | null, username: string | null) {
  if (!address) return ''
  const host = new URL(address).host
  return username ? `${username} on ${host}` : host
}

/** Finds tasks of the person's CalDAV account by title: a list may hold thousands. */
export function CalDavPicker({
  onAdd,
  onDone,
}: {
  onAdd: (tasks: Task[]) => void
  onDone: () => void
}) {
  const me = useQuery({ queryKey: ['caldav'], queryFn: getCalDav })
  const lists = useQuery({ queryKey: ['caldav', 'lists'], queryFn: getCalDavLists })
  const shown = lists.data?.filter((list) => list.shown) ?? []
  const [query, setQuery] = useState('')
  const [listId, setListId] = useState<string>(ALL)
  const [done, setDone] = useState(false)
  // Kept by key across searches, so tasks found by different words go on the board together.
  const [ticked, setTicked] = useState<Map<string, Task>>(new Map())
  const asked = useDebounced(query.trim(), SEARCH_DELAY_MS)
  const scope = listId === ALL ? null : listId
  const tasks = useQuery({
    queryKey: ['caldav', 'tasks', asked, scope, done],
    queryFn: () => findCalDavTasks(asked, scope, done),
    enabled: shown.length > 0,
    placeholderData: (previous) => previous,
  })

  if (lists.isPending)
    return <p className="text-muted-foreground p-1 text-[13px]">Loading lists…</p>
  if (lists.isError)
    return <p className="text-destructive p-1 text-[13px]">{errorMessage(lists.error)}</p>
  if (shown.length === 0)
    return (
      <p className="text-muted-foreground p-1 text-[13px]">
        No task lists are switched on in Settings → My tracker.
      </p>
    )

  const add = (chosen: Task[]) => {
    if (chosen.length === 0) return
    onAdd(chosen)
    onDone()
  }
  const toggle = (task: Task) =>
    setTicked((before) => {
      const next = new Map(before)
      if (next.has(task.key)) next.delete(task.key)
      else next.set(task.key, task)
      return next
    })
  const found = tasks.data?.tasks ?? []
  const more = (tasks.data?.total ?? 0) - found.length
  const current: TaskList | undefined = shown.find((list) => list.id === listId)
  const from = account(me.data?.address ?? null, me.data?.username ?? null)

  return (
    <div className="flex flex-col gap-2">
      {from && <p className="text-muted-foreground truncate text-xs">{from}</p>}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            aria-label="Search tasks"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title"
            className="h-8 pl-7 text-[13px]"
            autoFocus
            spellCheck={false}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 max-w-36 gap-1.5 px-2 text-[13px]"
              aria-label="Task list"
            >
              {current && <Dot color={current.color} />}
              <span className="truncate">{current?.name ?? 'All lists'}</span>
              <ChevronDown className="size-3.5 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
            <DropdownMenuRadioGroup value={listId} onValueChange={setListId}>
              <DropdownMenuRadioItem value={ALL}>All lists</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {shown.map((list) => (
                <DropdownMenuRadioItem key={list.id} value={list.id}>
                  <Dot color={list.color} />
                  {list.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {tasks.isPending && <p className="text-muted-foreground p-1 text-[13px]">Loading tasks…</p>}
        {tasks.isError && (
          <p className="text-destructive p-1 text-[13px]">{errorMessage(tasks.error)}</p>
        )}
        {tasks.isSuccess && found.length === 0 && (
          <p className="text-muted-foreground p-1 text-[13px]">
            {asked ? 'No tasks match.' : done ? 'No tasks here.' : 'No open tasks here.'}
          </p>
        )}
        <ul className="flex flex-col">
          {found.map((task) => (
            <li key={task.key}>
              <button
                type="button"
                aria-pressed={ticked.has(task.key)}
                onClick={() => toggle(task)}
                className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-[13px]"
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                    ticked.has(task.key) && 'bg-primary border-primary text-primary-foreground',
                  )}
                >
                  {ticked.has(task.key) && <Check className="size-3" strokeWidth={2.5} />}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    task.status_category === 'done' && 'text-muted-foreground line-through',
                  )}
                >
                  {task.summary}
                </span>
                {listId === ALL && (
                  <span className="text-muted-foreground shrink-0 text-xs">{task.type_name}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {more > 0 && (
        <p className="text-muted-foreground text-[13px]">
          And {more} more. Type a few words of the title to find the one you need.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Switch id="caldav-done" checked={done} onCheckedChange={setDone} />
        <Label htmlFor="caldav-done" className="font-normal">
          Show done
        </Label>
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={found.length === 0}
            onClick={() => add(found)}
          >
            {found.length > 1 ? `Add these ${found.length}` : 'Add this'}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={ticked.size === 0}
            onClick={() => add([...ticked.values()])}
          >
            {ticked.size > 0 ? `Add ${ticked.size}` : 'Add'}
          </Button>
        </div>
      </div>
    </div>
  )
}
