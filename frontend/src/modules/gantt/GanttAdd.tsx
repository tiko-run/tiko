import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { getSettings } from '@/api/settings'
import type { Task } from '@/api/tasks'
import { keepOpenWhileSuggesting } from '@/canvas/JqlInput'
import { CardSources } from '@/canvas/Toolbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const TRACKER_NAMES = { jira: 'Jira', demo: 'Demo tasks' }

type Props = {
  disabled: boolean
  onTasks: (tasks: Task[]) => void
  onPlain: (title: string) => void
}

/** One "Add" for the chart: a task from the tracker (keys, links or its query language) or a plain one. */
export function GanttAdd({ disabled, onTasks, onPlain }: Props) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<'tracker' | 'plain'>('tracker')
  // Asked only when the popover opens: a view-only board, or a guest's, never needs it.
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings, enabled: open })
  const tracker = settings.data ? TRACKER_NAMES[settings.data.provider] : 'Tracker'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={open ? 'secondary' : 'ghost'} disabled={disabled}>
          <Plus className="size-3.5" />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="flex w-96 flex-col gap-2 p-2"
        onEscapeKeyDown={keepOpenWhileSuggesting}
      >
        <div role="tablist" className="bg-muted flex gap-0.5 rounded-md p-0.5">
          {(
            [
              ['tracker', tracker],
              ['plain', 'Plain task'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              role="tab"
              size="sm"
              aria-selected={source === value}
              variant={source === value ? 'secondary' : 'ghost'}
              className="h-7 flex-1"
              onClick={() => setSource(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {source === 'tracker' ? (
          <CardSources onAdd={onTasks} onDone={() => setOpen(false)} />
        ) : (
          <PlainForm
            onAdd={(title) => {
              onPlain(title)
              setOpen(false)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function PlainForm({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (title.trim()) onAdd(title.trim())
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <label htmlFor="plain-task" className="text-muted-foreground text-[13px]">
        Title
      </label>
      <Input
        id="plain-task"
        value={title}
        maxLength={200}
        autoFocus
        autoComplete="off"
        placeholder="Design review"
        onChange={(event) => setTitle(event.target.value)}
      />
      <p className="text-muted-foreground text-[13px]">
        Lives only on this board; dragged out, it becomes a sticky note.
      </p>
    </form>
  )
}
