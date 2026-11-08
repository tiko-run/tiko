import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { getCalDavLists, getListTasks } from '@/api/caldav'
import type { Task } from '@/api/tasks'
import { errorMessage } from '@/canvas/refs'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** Tasks picked from one of the person's CalDAV lists: their ids are not typed. */
export function CalDavPicker({
  onAdd,
  onDone,
}: {
  onAdd: (tasks: Task[]) => void
  onDone: () => void
}) {
  const lists = useQuery({ queryKey: ['caldav', 'lists'], queryFn: getCalDavLists })
  const shown = lists.data?.filter((list) => list.shown) ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const listId = picked ?? shown[0]?.id ?? null
  const [done, setDone] = useState(false)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const tasks = useQuery({
    queryKey: ['caldav', 'tasks', listId, done],
    queryFn: () => getListTasks(listId!, done),
    enabled: listId !== null,
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
  const toggle = (key: string) =>
    setTicked((before) => {
      const next = new Set(before)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const found = tasks.data?.tasks ?? []
  const chosen = found.filter((task) => ticked.has(task.key))

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Task list" className="flex flex-wrap gap-1">
        {shown.map((list) => (
          <Button
            key={list.id}
            type="button"
            role="radio"
            aria-checked={list.id === listId}
            variant={list.id === listId ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-[13px]"
            onClick={() => {
              setPicked(list.id)
              setTicked(new Set())
            }}
          >
            {list.color && (
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: `#${list.color}` }}
              />
            )}
            {list.name}
          </Button>
        ))}
      </div>
      <div className="max-h-64 overflow-y-auto">
        {tasks.isPending && <p className="text-muted-foreground p-1 text-[13px]">Loading tasks…</p>}
        {tasks.isError && (
          <p className="text-destructive p-1 text-[13px]">{errorMessage(tasks.error)}</p>
        )}
        {tasks.isSuccess && found.length === 0 && (
          <p className="text-muted-foreground p-1 text-[13px]">
            {done ? 'This list has no tasks.' : 'No open tasks in this list.'}
          </p>
        )}
        <ul className="flex flex-col">
          {found.map((task) => (
            <li key={task.key}>
              <button
                type="button"
                aria-pressed={ticked.has(task.key)}
                onClick={() => toggle(task.key)}
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
                    'truncate',
                    task.status_category === 'done' && 'text-muted-foreground line-through',
                  )}
                >
                  {task.summary}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {tasks.data && tasks.data.total > found.length && (
        <p className="text-muted-foreground text-[13px]">
          Showing the first {found.length} of {tasks.data.total}.
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
            Add all
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={chosen.length === 0}
            onClick={() => add(chosen)}
          >
            {chosen.length > 0 ? `Add ${chosen.length}` : 'Add'}
          </Button>
        </div>
      </div>
    </div>
  )
}
