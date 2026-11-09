import { CircleCheck, X } from 'lucide-react'
import type { ImportResult } from '@/api/boards'
import type { Task } from '@/api/tasks'
import { Button } from '@/components/ui/button'
import { openSettings, type Section } from '@/settings/store'
import { credentialName, sourceName } from '@/sources/registry'

const KINDS: [string, string, string][] = [
  ['cards', 'card', 'cards'],
  ['stickies', 'sticky', 'stickies'],
  ['shapes', 'shape', 'shapes'],
  ['texts', 'text', 'texts'],
  ['frames', 'frame', 'frames'],
  ['pictures', 'picture', 'pictures'],
  ['modules', 'Gantt', 'Gantts'],
  ['reminders', 'reminder', 'reminders'],
  ['arrows', 'arrow', 'arrows'],
]

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

type Item = { key: string; text: string; action?: { label: string; section: Section } }

/** What still needs a hand, read live: a tracker connected meanwhile drops out of the list. */
function itemsOf(report: ImportResult, tasks: Record<string, Task>): Item[] {
  const waiting = new Map<string, { state: Task['state']; n: number }>()
  // The index holds a task under its full ref and its bare key alike.
  for (const task of new Set(Object.values(tasks))) {
    if (task.state !== 'not_connected' && task.state !== 'no_token') continue
    const key = `${task.state}:${task.source}`
    waiting.set(key, { state: task.state, n: (waiting.get(key)?.n ?? 0) + 1 })
  }
  const items: Item[] = []
  for (const [key, { state, n }] of waiting) {
    const source = key.slice(key.indexOf(':') + 1)
    const name = sourceName(source)
    items.push(
      state === 'not_connected'
        ? {
            key,
            text: `${count(n, 'task', 'tasks')} from ${name} ${n === 1 ? 'shows what it was' : 'show what they were'} at export. ${n === 1 ? 'It goes' : 'They go'} live once this tiko is connected to ${name}.`,
            action: { label: 'Task source', section: 'task-source' },
          }
        : {
            key,
            text: `${count(n, 'task', 'tasks')} from ${name} ${n === 1 ? 'waits' : 'wait'} for your ${name} ${credentialName(source)}.`,
            action: { label: 'My tracker', section: 'tracker' },
          },
    )
  }
  report.notes.forEach((note, i) => {
    items.push({
      key: `note-${i}`,
      text: note.text,
      action:
        note.kind === 'picture' ? undefined : { label: 'Stages and people', section: 'planning' },
    })
  })
  return items
}

export function ImportReport({
  report,
  tasks,
  onClose,
}: {
  report: ImportResult
  tasks: Record<string, Task>
  onClose: () => void
}) {
  const moved = KINDS.filter(([kind]) => report.moved[kind]).map(([kind, one, many]) =>
    count(report.moved[kind], one, many),
  )
  const items = itemsOf(report, tasks)
  return (
    <div
      role="region"
      aria-label="Import report"
      className="bg-card absolute top-20 right-4 z-20 flex max-h-[calc(100%-7rem)] w-80 max-w-[calc(100%-2rem)] flex-col gap-3 overflow-auto rounded-lg border p-3 shadow-md"
    >
      <div className="flex items-start gap-2">
        <CircleCheck className="text-primary mt-0.5 size-4 shrink-0" strokeWidth={2} />
        <div className="flex-1">
          <p className="text-sm font-medium">Board imported</p>
          {moved.length > 0 && (
            <p className="text-muted-foreground text-[13px]">{moved.join(' · ')}</p>
          )}
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col gap-2 border-t pt-3">
          {items.map((item) => (
            <li key={item.key} className="flex flex-col items-start gap-1 text-[13px]">
              <span>{item.text}</span>
              {item.action && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => openSettings(item.action!.section)}
                >
                  {item.action.label}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
