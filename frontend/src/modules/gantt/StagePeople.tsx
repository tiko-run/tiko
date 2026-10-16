import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { addPerson, storePerson, type Person } from '@/api/planning'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toastError } from '@/lib/toast'

// Mirrors MAX_STAGE_PEOPLE in backend/app/domain/modules/gantt.py.
export const MAX_STAGE_PEOPLE = 10
const SHOWN = 6

export type Named = { id: string; name: string; archived: boolean }

/** The stage's people by name; an id the instance does not know reads "Unknown". */
export function stagePeople(ids: string[], people: Person[]): Named[] {
  return ids.map((id) => {
    const person = people.find((p) => p.id === id)
    return { id, name: person?.name ?? 'Unknown', archived: person?.archived ?? true }
  })
}

type Suggestion =
  | { kind: 'person'; person: Person }
  | { kind: 'tracker'; name: string }
  | { kind: 'new'; name: string }

/**
 * Picks from the directory first, then assignees of this Gantt's tasks nobody has added yet;
 * an unknown name can be added on the spot. Nobody joins the directory until picked.
 */
export function suggestions(
  query: string,
  chosen: string[],
  people: Person[],
  assignees: string[],
): Suggestion[] {
  const q = query.trim().toLocaleLowerCase()
  const known = new Set(people.map((p) => p.name.toLocaleLowerCase()))
  const listed = people
    .filter((p) => !p.archived && !chosen.includes(p.id) && p.name.toLocaleLowerCase().includes(q))
    .map((person) => ({ kind: 'person' as const, person }))
  const tracker = assignees
    .filter((name) => !known.has(name.toLocaleLowerCase()) && name.toLocaleLowerCase().includes(q))
    .map((name) => ({ kind: 'tracker' as const, name }))
  const found = [...listed, ...tracker].slice(0, SHOWN)
  const exact = [...people.filter((p) => !p.archived).map((p) => p.name), ...assignees].some(
    (name) => name.toLocaleLowerCase() === q,
  )
  return q && !exact ? [...found, { kind: 'new', name: query.trim() }] : found
}

type Props = {
  chosen: string[]
  people: Person[]
  assignees: string[]
  onPeople: (ids: string[]) => void
}

/** People of a stage in its popover: chips to remove, a field that finds or adds someone. */
export function StagePeople({ chosen, people, assignees, onPeople }: Props) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const shown = open || query ? suggestions(query, chosen, people, assignees) : []
  const full = chosen.length >= MAX_STAGE_PEOPLE

  const pick = async (choice: Suggestion) => {
    if (choice.kind === 'person') {
      onPeople([...chosen, choice.person.id])
      setQuery('')
      return
    }
    if (saving) return
    setSaving(true)
    try {
      const source = choice.kind === 'tracker' ? 'tracker' : 'manual'
      const added = await addPerson({ name: choice.name, source })
      storePerson(queryClient, added)
      onPeople([...chosen, added.id])
      setQuery('')
    } catch (error) {
      toastError(error as Error)
    } finally {
      setSaving(false)
    }
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !shown.length) return
    event.preventDefault()
    void pick(shown[0])
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-[12px]">People</span>
      <div className="flex flex-wrap gap-1">
        {stagePeople(chosen, people).map((p) => (
          <span
            key={p.id}
            className={cn(
              'bg-muted inline-flex items-center rounded-full py-0.5 pl-2 text-[12px]',
              p.archived && 'text-muted-foreground',
            )}
          >
            {p.name}
            <button
              type="button"
              aria-label={`Remove ${p.name}`}
              onClick={() => onPeople(chosen.filter((id) => id !== p.id))}
              className="text-muted-foreground hover:text-foreground px-1.5"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {chosen.length === 0 && (
          <span className="text-muted-foreground text-[12px]">Nobody yet</span>
        )}
      </div>
      {!full && (
        <Input
          aria-label="Add a person"
          placeholder="Add a person"
          maxLength={80}
          value={query}
          disabled={saving}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          className="h-8"
        />
      )}
      {!full && shown.length > 0 && (
        <div role="listbox" aria-label="People to add" className="flex flex-col">
          {shown.map((choice, i) => (
            <button
              key={choice.kind === 'person' ? choice.person.id : `${choice.kind}:${choice.name}`}
              type="button"
              role="option"
              aria-selected={i === 0}
              // Keeps the field focused, so the list stays open for the next pick.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void pick(choice)}
              className={cn(
                'hover:bg-accent flex items-center gap-2 rounded-[4px] px-1.5 py-1 text-left text-[13px]',
                i === 0 && 'bg-accent',
              )}
            >
              {choice.kind === 'new' ? (
                <span>+ Add “{choice.name}” to people</span>
              ) : (
                <>
                  <span className="truncate">
                    {choice.kind === 'person' ? choice.person.name : choice.name}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-[12px]">
                    {choice.kind === 'person' ? choice.person.teams.join(', ') : 'From tracker'}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
