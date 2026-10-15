import { useQueryClient } from '@tanstack/react-query'
import { Check, Circle, ListChecks } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  ITEMS,
  saveOnboarding,
  useOnboarding,
  type Item,
  type OnboardingChange,
} from '@/api/onboarding'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { setChecklistOpen, useChecklistOpen } from '@/onboarding/checklist-open'
import { onOnboardingDone } from '@/onboarding/done'
import { openSettings } from '@/settings/store'

const LABELS: Record<Item, string> = {
  add_card: 'Add a task card',
  paste_link: 'Paste a task link onto the board',
  search_filter: 'Search with a filter',
  set_timer: 'Set a reminder',
  timer_list: 'Open the list of timers',
  gantt_task: 'Put a task into a Gantt chart',
  focus: 'Start a focus session',
  tracker: 'Connect your tracker',
}

// Loaded on the first Show me: most people never press it.
const Coach = lazy(() => import('@/onboarding/Coach'))

// Long enough for the check to play once before the pill goes.
const ALL_DONE_MS = 2400

/** The getting started pill and list; ticks items for as long as the person is signed in. */
export function GettingStarted({ demo = false }: { demo?: boolean }) {
  const queryClient = useQueryClient()
  const state = useOnboarding().data
  const change = (next: OnboardingChange) => saveOnboarding(queryClient, next)
  const open = useChecklistOpen()
  const [coaching, setCoaching] = useState<Exclude<Item, 'tracker'> | null>(null)
  const stopCoaching = useCallback(() => setCoaching(null), [])
  const items = ITEMS.filter((item) => !(demo && item === 'tracker'))
  const done = items.filter((item) => state?.done[item])
  const allDone = done.length === items.length

  const latest = useRef({ state, change })
  latest.current = { state, change }
  // Items sent this session: two quick events for one item, or one before the state has
  // loaded, still make one request. The server keeps an item's first time anyway.
  const sent = useRef(new Set<Item>())
  useEffect(
    () =>
      onOnboardingDone((item) => {
        const { state: now, change: send } = latest.current
        if (sent.current.has(item) || now?.done[item]) return
        sent.current.add(item)
        send({ done: [item] })
      }),
    [],
  )

  // The list goes away by itself only when its last item is done now, not when About
  // brings back a list that was finished before.
  const wasAllDone = useRef<boolean | null>(null)
  const finished = useRef(false)
  if (state && wasAllDone.current !== allDone) {
    if (wasAllDone.current === false && allDone) finished.current = true
    wasAllDone.current = allDone
  }
  const hidden = state?.hidden ?? true
  useEffect(() => {
    if (hidden || !finished.current) return
    const timer = setTimeout(() => {
      finished.current = false
      latest.current.change({ hidden: true })
    }, ALL_DONE_MS)
    return () => clearTimeout(timer)
  }, [hidden, allDone])

  // The tour comes first; the list shows up once it is over.
  if (!state?.tour_seen || state.hidden) return null

  const showMe = (item: Item) => {
    setChecklistOpen(false)
    if (item === 'tracker') openSettings('tracker')
    else setCoaching(item)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setChecklistOpen}>
        <div className="bg-card rounded-lg border p-1 shadow-md">
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn('gap-1.5 text-[13px]', finished.current && 'getting-started-done')}
              aria-label={`Getting started, ${done.length} of ${items.length} done`}
            >
              {allDone ? (
                <Check className="text-primary size-4" strokeWidth={2} />
              ) : (
                <ListChecks className="size-4" strokeWidth={1.75} />
              )}
              Getting started
              <span className="text-muted-foreground font-mono text-[12px]">
                {done.length}/{items.length}
              </span>
            </Button>
          </PopoverTrigger>
        </div>
        <PopoverContent side="top" align="start" className="w-80 gap-2 p-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[14px] font-semibold">Getting started</h2>
            <span className="text-muted-foreground text-[12px]">
              {done.length} of {items.length}
            </span>
          </div>
          <div className="bg-muted h-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${(done.length / items.length) * 100}%` }}
            />
          </div>
          <ul className="-mx-1 flex flex-col" aria-label="Getting started">
            {items.map((item) => {
              const isDone = !!state.done[item]
              return (
                <li key={item} className="flex min-h-8 items-center gap-2 px-1 text-[13px]">
                  {isDone ? (
                    <Check className="text-primary size-4 shrink-0" strokeWidth={2} aria-hidden />
                  ) : (
                    <Circle
                      className="text-muted-foreground size-4 shrink-0"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                  )}
                  <span className={cn('flex-1', isDone && 'text-muted-foreground line-through')}>
                    {LABELS[item]}
                    <span className="sr-only">{isDone ? ', done' : ', not done yet'}</span>
                  </span>
                  {!isDone && (
                    <Button variant="ghost" size="xs" onClick={() => showMe(item)}>
                      Show me
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="flex justify-end border-t pt-2">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => {
                setChecklistOpen(false)
                change({ hidden: true })
              }}
            >
              Hide
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {coaching && (
        <Suspense fallback={null}>
          <Coach key={coaching} item={coaching} onClose={stopCoaching} />
        </Suspense>
      )}
    </>
  )
}
