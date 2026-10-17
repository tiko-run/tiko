import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { addView, storeView } from '@/api/planning'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  filterOptions,
  FILTER_BAR,
  PERSON,
  sameFilters,
  TEAM,
  toggleFilter,
  withFilters,
} from '@/modules/gantt/filters'
import type { GanttContent } from '@/modules/gantt/schema'
import { cn } from '@/lib/utils'
import { toastError } from '@/lib/toast'
import type { PlanningState } from '@/planning/context'

type Props = {
  content: GanttContent
  planning: PlanningState
  onChange: (content: GanttContent) => void
}

/** Saved views as pills, the Gantt's filters as chips, "+ Filter" and "Save as view". */
export function GanttFilters({ content, planning, onChange }: Props) {
  const filters = content.filters ?? {}
  const keys = Object.keys(filters)
  const current = planning.views.find((view) => sameFilters(view.filters, filters))
  const nameOf = (key: string) =>
    key === PERSON ? 'Person' : (planning.fields.find((f) => f.id === key)?.name ?? 'Unknown')
  const labelOf = (key: string, value: string) =>
    key === PERSON ? (planning.people.find((p) => p.id === value)?.name ?? 'Unknown') : value
  return (
    <div
      data-gantt-filters
      className="nowheel flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-2 whitespace-nowrap"
      style={{ height: FILTER_BAR }}
    >
      {planning.views.length > 0 && (
        <>
          <span className="text-muted-foreground">Views</span>
          {planning.views.map((view) => {
            const on = view === current
            return (
              <button
                key={view.id}
                type="button"
                aria-pressed={on}
                title={on ? 'Show every task' : `Show ${view.name}`}
                onClick={() => onChange(withFilters(content, on ? {} : view.filters))}
                className={cn(
                  'bg-card hover:bg-accent shrink-0 rounded-full border px-2.5 leading-5',
                  on && 'border-primary text-primary bg-accent',
                )}
              >
                {view.name}
              </button>
            )
          })}
          <span className="bg-border mx-1 h-4 w-px shrink-0" />
        </>
      )}
      {keys.map((key) => (
        <span
          key={key}
          className="bg-accent inline-flex h-6 shrink-0 items-center rounded-[3px] pl-2"
        >
          <FilterPicker content={content} planning={planning} onChange={onChange} start={key}>
            <button type="button" className="hover:underline">
              <span className="text-muted-foreground">{nameOf(key)}:</span>{' '}
              {filters[key].map((value) => labelOf(key, value)).join(', ')}
            </button>
          </FilterPicker>
          <button
            type="button"
            aria-label={`Remove the ${nameOf(key)} filter`}
            onClick={() => onChange(withFilters(content, without(filters, key)))}
            className="text-muted-foreground hover:text-foreground px-1"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <FilterPicker content={content} planning={planning} onChange={onChange}>
        <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[12px]">
          <Plus className="size-3.5" />
          Filter
        </Button>
      </FilterPicker>
      {keys.length > 0 && !current && <SaveView filters={filters} />}
    </div>
  )
}

function without(filters: Record<string, string[]>, key: string) {
  const { [key]: _gone, ...rest } = filters
  return rest
}

/** First the field or Person, then its values as checkboxes; a chip opens straight on its values. */
function FilterPicker({
  content,
  planning,
  onChange,
  start,
  children,
}: Props & { start?: string; children: ReactNode }) {
  const [key, setKey] = useState<string | null>(start ?? null)
  const choices = [
    ...planning.fields.filter((f) => !f.archived).map((f) => ({ id: f.id, name: f.name })),
    { id: PERSON, name: 'Person' },
  ]
  const chosen = content.filters?.[key ?? ''] ?? []
  const options = key ? filterOptions(content, planning, key) : []
  return (
    <Popover onOpenChange={(open) => open && setKey(start ?? null)}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-56 p-2 text-[13px]">
        {key === null ? (
          <div role="group" aria-label="Filter by" className="flex flex-col">
            <div className="px-2 py-1 font-semibold">Filter by</div>
            {choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => setKey(choice.id)}
                className="hover:bg-accent rounded-[4px] px-2 py-1 text-left"
              >
                {choice.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 font-semibold">
              {!start && (
                <button
                  type="button"
                  aria-label="Back to fields"
                  onClick={() => setKey(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="size-4" />
                </button>
              )}
              <span className="px-1 py-1">{choices.find((c) => c.id === key)?.name}</span>
            </div>
            {options.length === 0 && (
              <p className="text-muted-foreground px-2 pb-1 text-[12px]">
                {key === PERSON
                  ? 'Nobody has a stage here yet.'
                  : 'No values yet. Fill this column first.'}
              </p>
            )}
            <div className="flex max-h-60 flex-col overflow-y-auto">
              {options.map((option) => (
                <label
                  key={option.value}
                  className="hover:bg-accent flex items-center gap-2 rounded-[4px] px-2 py-1"
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(option.value)}
                    onChange={() => onChange(toggleFilter(content, key, option.value))}
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              ))}
            </div>
            {key === TEAM && (
              <p className="text-muted-foreground px-2 text-[12px]">
                Also shows rows where a person of the team has a stage.
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function SaveView({ filters }: { filters: Record<string, string[]> }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      storeView(queryClient, await addView({ name: trimmed, filters }))
      setName('')
      setOpen(false)
    } catch (error) {
      toastError(error as Error)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[12px]">
          Save as view
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-64 p-3 text-[13px]">
        <form onSubmit={save} className="flex flex-col gap-2">
          <div className="font-semibold">Save as view</div>
          <div className="flex gap-1.5">
            <Input
              autoFocus
              aria-label="View name"
              placeholder="e.g. Web in Q4"
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-8"
            />
            <Button type="submit" size="sm" disabled={!name.trim() || saving}>
              Save
            </Button>
          </div>
          <p className="text-muted-foreground text-[12px]">
            A view is a saved set of filters. Every board with a Gantt lists it.
          </p>
        </form>
      </PopoverContent>
    </Popover>
  )
}
