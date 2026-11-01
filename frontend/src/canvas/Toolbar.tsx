import { useMutation } from '@tanstack/react-query'
import {
  AlarmClock,
  Frame,
  Hand,
  LayoutTemplate,
  MousePointer2,
  Shapes,
  StickyNote,
  TicketPlus,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { searchTasks, type Task } from '@/api/tasks'
import { SHAPES, shapePath, type ShapeKind } from '@/canvas/shapes'
import {
  errorMessage,
  hasRange,
  MAX_REFS,
  REF_RE,
  resolveAll,
  splitRefs,
  type Resolved,
} from '@/canvas/refs'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ModulePicker } from '@/modules/ModulePicker'
import { MODULES } from '@/modules/registry'
import { useCommands } from '@/search/commands'
import { JqlInput, keepOpenWhileSuggesting, useJqlCount } from '@/canvas/JqlInput'
import { SHORTCUTS, useShortcut, withShortcut } from '@/lib/shortcuts'
import { useAutoTour } from '@/onboarding/start'
import { readRecentInputs, rememberInput } from '@/lib/recent-inputs'

export type Tool = 'select' | 'hand' | 'frame' | 'sticky' | 'text' | 'shape' | 'timer'

const TOOLS: { tool: Exclude<Tool, 'shape'>; Icon: LucideIcon }[] = [
  { tool: 'select', Icon: MousePointer2 },
  { tool: 'hand', Icon: Hand },
  { tool: 'frame', Icon: Frame },
  { tool: 'sticky', Icon: StickyNote },
  { tool: 'text', Icon: Type },
  { tool: 'timer', Icon: AlarmClock },
]

// Tools that place an element; the palette offers them as "Add …".
const PLACE_COMMANDS = [
  { tool: 'sticky', title: 'Add sticky note', Icon: StickyNote },
  { tool: 'text', title: 'Add text', Icon: Type },
  { tool: 'frame', title: 'Add frame', Icon: Frame },
  { tool: 'timer', title: 'Add reminder', Icon: AlarmClock },
] as const

// Input with a JQL operator that is not just keys and links is a query; a lone typo stays a key.
const JQL_OPERATOR = /[=~<>!]|\b(in|is|was|changed)\b/i

export function isJql(input: string) {
  const refs = splitRefs(input)
  return JQL_OPERATOR.test(input) && !refs.every((ref) => REF_RE.test(ref))
}

const WHAT_YOU_CAN_ADD = 'https://docs.tiko.run/what-you-can-add/'

function matchCount(total: number, estimated: boolean) {
  const tasks = `${estimated ? 'About ' : ''}${total} ${total === 1 ? 'task matches' : 'tasks match'}`
  return `${tasks}${total > MAX_REFS ? `, the first ${MAX_REFS} are added` : ''}.`
}

async function addFromInput(input: string): Promise<Resolved> {
  if (!isJql(input)) return resolveAll(splitRefs(input))
  const { tasks, total, estimated } = await searchTasks(input.trim(), MAX_REFS)
  return { tasks, failed: [], total, estimated }
}

/** Takes keys, links or a JQL query; keys that fail stay in the field with their errors. */
export function AddCardForm({
  onAdd,
  onDone,
}: {
  onAdd: (tasks: Task[]) => void
  onDone: () => void
}) {
  const [input, setInput] = useState('')
  const [recent] = useState(readRecentInputs)
  const resolve = useMutation({
    mutationFn: addFromInput,
    onSuccess: ({ tasks, failed, total }, sent) => {
      if (tasks.length > 0) {
        onAdd(tasks)
        rememberInput(sent)
      }
      // A query that found nothing or more than fits stays open to be narrowed.
      if (total !== undefined && (tasks.length === 0 || total > tasks.length)) return
      if (failed.length === 0) onDone()
      else setInput(failed.map((f) => f.ref).join(', '))
    },
  })
  const jql = isJql(input)
  const count = useJqlCount(input, jql && !resolve.isPending)
  const keys = jql ? 0 : splitRefs(input).length
  const tooMany = keys > MAX_REFS

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (input.trim() && !tooMany) resolve.mutate(input)
  }

  const found = resolve.data?.total
  const errors = tooMany
    ? [`Up to ${MAX_REFS} cards at a time.`]
    : resolve.isError
      ? [errorMessage(resolve.error)]
      : found === 0
        ? ['No tasks match this query.']
        : found !== undefined && found > (resolve.data?.tasks.length ?? 0)
          ? [
              `Added ${resolve.data?.tasks.length} of ${resolve.data?.estimated ? 'about ' : ''}${found}. Narrow the query to add the rest.`,
            ]
          : (resolve.data?.failed.map((f) => `${f.ref}: ${f.message}`) ?? [])

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <label htmlFor="card-ref" className="sr-only">
        Issue keys, links or JQL
      </label>
      <JqlInput
        id="card-ref"
        value={input}
        onValueChange={setInput}
        recent={recent}
        onPickRecent={(picked) => {
          setInput(picked)
          resolve.mutate(picked)
        }}
        placeholder="DEMO-1, DEMO-2"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        disabled={resolve.isPending}
      />
      {errors.length > 0 ? (
        <ul role="alert" className="text-destructive text-[13px]">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : (
        <p
          className={cn(
            'text-[13px]',
            count.isError ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {!jql ? (
            hasRange(input) ? (
              `${keys} ${keys === 1 ? 'card' : 'cards'} from the range.`
            ) : (
              <>
                Keys, links or a query.{' '}
                <a
                  href={WHAT_YOU_CAN_ADD}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  What you can add
                </a>
              </>
            )
          ) : count.isError ? (
            errorMessage(count.error)
          ) : count.data !== undefined ? (
            matchCount(count.data.total, count.data.estimated)
          ) : (
            `JQL query, up to ${MAX_REFS} tasks.`
          )}
        </p>
      )}
    </form>
  )
}

type Props = {
  tool: Tool
  onTool: (tool: Tool) => void
  /** Picks a shape and switches to the shape tool. */
  onShape: (kind: ShapeKind) => void
  onAddCards: (tasks: Task[]) => void
  onAddModule: (kind: string) => void
}

const ICON = { width: 20, height: 14 }

function ShapeIcon({ kind }: { kind: ShapeKind }) {
  return (
    <svg aria-hidden className="overflow-visible" {...ICON}>
      <path
        d={shapePath(kind, ICON.width, ICON.height)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Toolbar({ tool, onTool, onShape, onAddCards, onAddModule }: Props) {
  const [open, setOpen] = useState(false)
  const [shapesOpen, setShapesOpen] = useState(false)
  const [modulesOpen, setModulesOpen] = useState(false)
  // The toolbar is on screen only on a board the person can edit, where the tour may start.
  useAutoTour()

  useShortcut('select', () => onTool('select'))
  useShortcut('hand', () => onTool('hand'))
  useShortcut('frame', () => onTool('frame'))
  useShortcut('sticky', () => onTool('sticky'))
  useShortcut('text', () => onTool('text'))
  useShortcut('shape', () => setShapesOpen(true))
  useShortcut('timer', () => onTool('timer'))
  useShortcut('card', () => setOpen(true))
  useShortcut('module', () => setModulesOpen(true))
  useCommands([
    ...PLACE_COMMANDS.map(({ tool: value, title, Icon }) => ({
      id: `tool:${value}`,
      title,
      group: 'Commands' as const,
      Icon,
      shortcut: value,
      run: () => onTool(value),
    })),
    ...SHAPES.map(({ kind, name }) => ({
      id: `shape:${kind}`,
      title: `Add ${name.toLowerCase()}`,
      group: 'Commands' as const,
      Icon: Shapes,
      keywords: 'shape',
      run: () => onShape(kind),
    })),
    {
      id: 'tool:card',
      title: 'Add task card',
      group: 'Commands',
      Icon: TicketPlus,
      shortcut: 'card',
      keywords: 'task issue key jql jira github',
      run: () => setOpen(true),
    },
    {
      id: 'tool:module',
      title: 'Add module',
      group: 'Commands',
      Icon: LayoutTemplate,
      shortcut: 'module',
      run: () => setModulesOpen(true),
    },
    ...MODULES.map((def) => ({
      id: `module:${def.kind}`,
      title: `Add ${def.name}`,
      group: 'Commands' as const,
      Icon: def.Icon,
      keywords: 'module',
      run: () => onAddModule(def.kind),
    })),
  ])

  return (
    <div className="bg-card absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border p-1 shadow-md">
      {TOOLS.map(({ tool: value, Icon }) => (
        <Button
          key={value}
          variant={tool === value ? 'secondary' : 'ghost'}
          size="icon"
          aria-label={SHORTCUTS[value].label}
          aria-pressed={tool === value}
          title={withShortcut(value)}
          data-tour={value === 'timer' ? 'tool-timer' : undefined}
          onClick={() => onTool(value)}
        >
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </Button>
      ))}
      <Popover open={shapesOpen} onOpenChange={setShapesOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={shapesOpen || tool === 'shape' ? 'secondary' : 'ghost'}
            size="icon"
            aria-label={SHORTCUTS.shape.label}
            aria-pressed={tool === 'shape'}
            title={withShortcut('shape')}
          >
            <Shapes className="size-[18px]" strokeWidth={1.75} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          sideOffset={10}
          className="grid w-auto grid-cols-4 gap-0.5 p-1"
          // Focus goes to the gallery, not its first shape: opened with a key, that shape would look picked.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            ;(event.currentTarget as HTMLElement).focus()
          }}
        >
          {SHAPES.map(({ kind, name }) => (
            <Button
              key={kind}
              variant="ghost"
              size="icon"
              aria-label={name}
              title={name}
              onClick={() => {
                onShape(kind)
                setShapesOpen(false)
              }}
            >
              <ShapeIcon kind={kind} />
            </Button>
          ))}
        </PopoverContent>
      </Popover>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={open ? 'secondary' : 'ghost'}
            size="icon"
            aria-label={SHORTCUTS.card.label}
            title={withShortcut('card')}
            data-tour="tool-card"
          >
            <TicketPlus className="size-[18px]" strokeWidth={1.75} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          sideOffset={10}
          className="w-96 p-2"
          onEscapeKeyDown={keepOpenWhileSuggesting}
        >
          <AddCardForm onAdd={onAddCards} onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      <Popover open={modulesOpen} onOpenChange={setModulesOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={modulesOpen ? 'secondary' : 'ghost'}
            size="icon"
            aria-label={SHORTCUTS.module.label}
            title={withShortcut('module')}
            data-tour="tool-module"
          >
            <LayoutTemplate className="size-[18px]" strokeWidth={1.75} />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" sideOffset={10} className="w-80 p-1">
          <ModulePicker
            onPick={(kind) => {
              onAddModule(kind)
              setModulesOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
