import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Me } from '@/api/auth'
import {
  addStageType,
  changeStageType,
  HUES,
  PLANNING_KEY,
  setPlanning,
  usePlanningQuery,
  type Hue,
  type Planning as PlanningData,
  type StageType,
} from '@/api/planning'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
        description="Stages for the Gantt, shared by every board on this tiko."
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
    </div>
  )
}

function StageTypes({ types }: { types: StageType[] }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const replace = (saved: StageType) =>
    queryClient.setQueryData<PlanningData>(
      PLANNING_KEY,
      (was) =>
        was && {
          ...was,
          types: was.types.some((t) => t.id === saved.id)
            ? was.types.map((t) => (t.id === saved.id ? saved : t))
            : [...was.types, saved],
        },
    )
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
    const used = new Set(active.map((t) => t.hue))
    const hue = HUES.find((h) => !used.has(h)) ?? HUES[active.length % HUES.length]
    if (name.trim()) add.mutate({ name: name.trim(), hue })
  }
  return (
    <Group title="Stage types">
      <ul className="flex flex-col gap-2">
        {active.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <TypeName type={t} onName={(next) => change.mutate({ id: t.id, name: next })} />
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

function TypeName({ type, onName }: { type: StageType; onName: (name: string) => void }) {
  const [draft, setDraft] = useState(type.name)
  const save = () => {
    const next = draft.trim()
    if (next && next !== type.name) onName(next)
    else setDraft(type.name)
  }
  return (
    <Input
      aria-label={`Name of ${type.name}`}
      maxLength={40}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      className="h-8 flex-1 font-medium"
      style={stageColors(type.hue)}
    />
  )
}
