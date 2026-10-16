import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Plus, X } from 'lucide-react'
import { useState, type CSSProperties, type FormEvent } from 'react'
import type { Me } from '@/api/auth'
import {
  addField,
  addPerson,
  addStageType,
  addTimeOff,
  changeField,
  changePerson,
  changeStageType,
  freeHue,
  HUES,
  parseTeams,
  PLANNING_KEY,
  removeTimeOff,
  setPlanning,
  storeField,
  storePerson,
  storeStageType,
  usePlanningQuery,
  type Field,
  type Hue,
  type Person,
  type StageType,
} from '@/api/planning'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { offDates } from '@/modules/gantt/timeoff'
import { cn } from '@/lib/utils'
import { toastError } from '@/lib/toast'
import { stageColors } from '@/planning/colors'
import { Group, SectionHeader } from '@/settings/sections/Section'

export function Planning({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const planning = usePlanningQuery()
  const admin = me.role === 'admin'
  const toggle = useMutation({
    mutationFn: setPlanning,
    onSuccess: (saved) => queryClient.setQueryData(PLANNING_KEY, saved),
    onError: toastError,
  })
  const enabled = planning.data?.enabled ?? false
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Planning"
        description="Stages and people for the Gantt, shared by every board on this tiko."
      />
      <Group title="Planning mode">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="planning-mode">Cut Gantt rows into stages</Label>
          <Switch
            id="planning-mode"
            checked={enabled}
            disabled={!planning.data || !admin || toggle.isPending}
            onCheckedChange={(on) => toggle.mutate(on)}
          />
        </div>
        <p className="text-muted-foreground text-[13px]">
          {admin
            ? 'Off by default. Switching it off keeps every stage; the Gantt shows one bar per task until it is on again.'
            : 'Only an admin can switch Planning on or off.'}
        </p>
      </Group>
      {enabled && planning.data && <StageTypes types={planning.data.types} />}
      {enabled && planning.data && <People people={planning.data.people} />}
      {enabled && planning.data && <Fields fields={planning.data.fields} />}
    </div>
  )
}

function StageTypes({ types }: { types: StageType[] }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const replace = (saved: StageType) => storeStageType(queryClient, saved)
  const change = useMutation({
    mutationFn: ({ id, ...rest }: { id: string; name?: string; hue?: Hue; archived?: boolean }) =>
      changeStageType(id, rest),
    onSuccess: replace,
    onError: toastError,
  })
  const add = useMutation({
    mutationFn: addStageType,
    onSuccess: (saved) => {
      replace(saved)
      setName('')
    },
    onError: toastError,
  })
  const active = types.filter((t) => !t.archived)
  const archived = types.filter((t) => t.archived)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) add.mutate({ name: name.trim(), hue: freeHue(types) })
  }
  return (
    <Group title="Stage types">
      <ul className="flex flex-col gap-2">
        {active.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <Draft
              label={`Name of ${t.name}`}
              value={t.name}
              maxLength={40}
              required
              onSave={(next) => change.mutate({ id: t.id, name: next })}
              className="font-medium"
              style={stageColors(t.hue)}
            />
            <div role="group" aria-label={`Color of ${t.name}`} className="flex gap-1">
              {HUES.map((hue) => (
                <button
                  key={hue}
                  type="button"
                  aria-label={`Hue ${hue}`}
                  aria-pressed={t.hue === hue}
                  onClick={() => change.mutate({ id: t.id, hue })}
                  className={cn(
                    'size-4 rounded-full',
                    t.hue === hue && 'ring-primary ring-2 ring-offset-1',
                  )}
                  style={{
                    background: stageColors(hue).background,
                    boxShadow: stageColors(hue).boxShadow,
                  }}
                />
              ))}
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Archive ${t.name}`}
              title="Archive: stages keep it, new stages cannot pick it"
              onClick={() => change.mutate({ id: t.id, archived: true })}
            >
              <Archive className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          aria-label="New stage type"
          placeholder="New type, e.g. Testing"
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!name.trim() || add.isPending}>
          Add
        </Button>
      </form>
      {archived.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[12px]">Archived</span>
          {archived.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{t.name}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => change.mutate({ id: t.id, archived: false })}
              >
                <ArchiveRestore className="size-4" />
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </Group>
  )
}

const SOURCES: Record<Person['source'], string> = {
  manual: 'Added by hand',
  tracker: 'Tracker assignee',
}

function People({ people }: { people: Person[] }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [teams, setTeams] = useState('')
  const replace = (saved: Person) => storePerson(queryClient, saved)
  const change = useMutation({
    mutationFn: ({
      id,
      ...rest
    }: {
      id: string
      name?: string
      teams?: string[]
      archived?: boolean
    }) => changePerson(id, rest),
    onSuccess: replace,
    onError: toastError,
  })
  const add = useMutation({
    mutationFn: addPerson,
    onSuccess: (saved) => {
      replace(saved)
      setName('')
      setTeams('')
    },
    onError: toastError,
  })
  const active = people.filter((p) => !p.archived)
  const archived = people.filter((p) => p.archived)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) add.mutate({ name: name.trim(), teams: parseTeams(teams) })
  }
  return (
    <Group title="People">
      <p className="text-muted-foreground text-[13px]">
        Who stages are planned for. Most of them never sign in; accounts are a list of their own.
      </p>
      {active.length > 0 && (
        <ul className="flex flex-col gap-2">
          {active.map((p) => (
            <li key={p.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Draft
                  label={`Name of ${p.name}`}
                  value={p.name}
                  maxLength={80}
                  required
                  onSave={(next) => change.mutate({ id: p.id, name: next })}
                  className="font-medium"
                />
                <Draft
                  label={`Teams of ${p.name}`}
                  placeholder="Teams"
                  value={p.teams.join(', ')}
                  onSave={(next) => change.mutate({ id: p.id, teams: parseTeams(next) })}
                />
                <span className="text-muted-foreground w-24 shrink-0 text-[12px]">
                  {SOURCES[p.source]}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Archive ${p.name}`}
                  title="Archive: stages keep the name, nobody offers it again"
                  onClick={() => change.mutate({ id: p.id, archived: true })}
                >
                  <Archive className="size-4" />
                </Button>
              </div>
              <TimeOffList person={p} />
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <Input
          aria-label="New person"
          placeholder="Name"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          aria-label="Teams of the new person"
          placeholder="Teams, e.g. Web, Core"
          value={teams}
          onChange={(event) => setTeams(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!name.trim() || add.isPending}>
          Add
        </Button>
      </form>
      {archived.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[12px]">Archived</span>
          {archived.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{p.name}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Restore ${p.name}`}
                onClick={() => change.mutate({ id: p.id, archived: false })}
              >
                <ArchiveRestore className="size-4" />
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </Group>
  )
}

function Fields({ fields }: { fields: Field[] }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const replace = (saved: Field) => storeField(queryClient, saved)
  const change = useMutation({
    mutationFn: ({ id, ...rest }: { id: string; name?: string; archived?: boolean }) =>
      changeField(id, rest),
    onSuccess: replace,
    onError: toastError,
  })
  const add = useMutation({
    mutationFn: addField,
    onSuccess: (saved) => {
      replace(saved)
      setName('')
    },
    onError: toastError,
  })
  const active = fields.filter((f) => !f.archived)
  const archived = fields.filter((f) => f.archived)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) add.mutate(name.trim())
  }
  return (
    <Group title="Fields">
      <p className="text-muted-foreground text-[13px]">
        Columns a Gantt can show next to the task titles. A child row shows its parent's value until
        it gets its own.
      </p>
      <ul className="flex flex-col gap-2">
        {active.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <Draft
              label={`Name of field ${f.name}`}
              value={f.name}
              maxLength={40}
              required
              onSave={(next) => change.mutate({ id: f.id, name: next })}
            />
            {f.standard ? (
              <span className="text-muted-foreground shrink-0 px-1 text-[12px]">Standard</span>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Archive field ${f.name}`}
                title="Archive: rows keep their values, the column is offered no more"
                onClick={() => change.mutate({ id: f.id, archived: true })}
              >
                <Archive className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          aria-label="New field"
          placeholder="New field, e.g. Quarter"
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!name.trim() || add.isPending}>
          Add
        </Button>
      </form>
      {archived.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[12px]">Archived</span>
          {archived.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{f.name}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Restore field ${f.name}`}
                onClick={() => change.mutate({ id: f.id, archived: false })}
              >
                <ArchiveRestore className="size-4" />
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </Group>
  )
}

/** A person's time off as chips to remove, and a form for a new range. Dates only. */
function TimeOffList({ person }: { person: Person }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [span, setSpan] = useState({ start: '', end: '' })
  const replace = (saved: Person) => storePerson(queryClient, saved)
  const add = useMutation({
    mutationFn: () => addTimeOff(person.id, span),
    onSuccess: (saved) => {
      replace(saved)
      setAdding(false)
      setSpan({ start: '', end: '' })
    },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: (offId: string) => removeTimeOff(person.id, offId),
    onSuccess: replace,
    onError: toastError,
  })
  const valid = Boolean(span.start && span.end) && span.end >= span.start
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (valid) add.mutate()
  }
  return (
    <div className="flex flex-wrap items-center gap-1 text-[12px]">
      <span className="text-muted-foreground mr-1">Time off</span>
      {person.off.map((off) => (
        <span
          key={off.id}
          className="bg-muted flex items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-2 tabular-nums"
        >
          {offDates(off)}
          <button
            type="button"
            aria-label={`Remove time off ${offDates(off)} of ${person.name}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate(off.id)}
            className="text-muted-foreground hover:text-foreground rounded-full p-0.5"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {person.off.length === 0 && !adding && <span className="text-muted-foreground">None</span>}
      {adding ? (
        <form onSubmit={submit} className="flex items-center gap-1">
          <Input
            type="date"
            aria-label={`${person.name} is away from`}
            value={span.start}
            onChange={(event) => setSpan({ ...span, start: event.target.value })}
            className="h-7 w-36 text-[12px]"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label={`${person.name} is away until`}
            value={span.end}
            min={span.start || undefined}
            onChange={(event) => setSpan({ ...span, end: event.target.value })}
            className="h-7 w-36 text-[12px]"
          />
          <Button type="submit" size="xs" variant="outline" disabled={!valid || add.isPending}>
            Add
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Add time off for ${person.name}`}
          onClick={() => setAdding(true)}
        >
          <Plus className="size-3" />
          Time off
        </Button>
      )}
    </div>
  )
}

/** Saved on blur or Enter; shows the live value until focused, so a change by someone else lands. */
function Draft({
  label,
  value,
  onSave,
  required = false,
  className,
  ...rest
}: {
  label: string
  value: string
  onSave: (next: string) => void
  required?: boolean
  className?: string
  style?: CSSProperties
  placeholder?: string
  maxLength?: number
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const save = () => {
    const next = (draft ?? value).trim()
    setDraft(null)
    if (next !== value && (next || !required)) onSave(next)
  }
  return (
    <Input
      aria-label={label}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      className={cn('h-8 flex-1', className)}
      {...rest}
    />
  )
}
