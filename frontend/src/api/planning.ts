import { useQuery, type QueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchJson } from '@/api/client'

// Mirrors `Hue` in backend/app/domain/planning.py.
export const HUES = [25, 60, 75, 150, 200, 250, 300, 340] as const
export type Hue = (typeof HUES)[number]

const stageTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  hue: z.number(),
  archived: z.boolean(),
})
export type StageType = z.infer<typeof stageTypeSchema>

const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  teams: z.array(z.string()),
  source: z.enum(['manual', 'tracker']),
  archived: z.boolean(),
})
export type Person = z.infer<typeof personSchema>

const planningSchema = z.object({
  enabled: z.boolean(),
  types: z.array(stageTypeSchema),
  people: z.array(personSchema),
})
export type Planning = z.infer<typeof planningSchema>

export const PLANNING_KEY = ['planning']
// Someone changed the instance's lists; the board's socket tells, the board rereads them.
export const PLANNING_CHANGED_EVENT = 'tiko:planning-changed'

/** What a guest gets in a board's public payload: the types and people its Gantts use. */
export const boardPlanningSchema = z.object({
  types: z.array(stageTypeSchema),
  people: z.array(personSchema),
})
export type BoardPlanning = z.infer<typeof boardPlanningSchema>

export function getPlanning() {
  return fetchJson('/api/planning', planningSchema)
}

export function setPlanning(enabled: boolean) {
  return fetchJson('/api/planning', planningSchema, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}

export function addStageType(input: { name: string; hue: Hue }) {
  return fetchJson('/api/planning/types', stageTypeSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function changeStageType(
  id: string,
  change: { name?: string; hue?: Hue; archived?: boolean },
) {
  return fetchJson(`/api/planning/types/${encodeURIComponent(id)}`, stageTypeSchema, {
    method: 'PATCH',
    body: JSON.stringify(change),
  })
}

export function addPerson(input: { name: string; teams?: string[]; source?: Person['source'] }) {
  return fetchJson('/api/planning/people', personSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function changePerson(
  id: string,
  change: { name?: string; teams?: string[]; archived?: boolean },
) {
  return fetchJson(`/api/planning/people/${encodeURIComponent(id)}`, personSchema, {
    method: 'PATCH',
    body: JSON.stringify(change),
  })
}

export function usePlanningQuery(enabled = true) {
  return useQuery({ queryKey: PLANNING_KEY, queryFn: getPlanning, enabled, staleTime: 60_000 })
}

/** A hue no active type has yet, so a new type stands apart from the others. */
export function freeHue(types: StageType[]): Hue {
  const active = types.filter((t) => !t.archived)
  const used = new Set(active.map((t) => t.hue))
  return HUES.find((h) => !used.has(h)) ?? HUES[active.length % HUES.length]
}

function store<K extends 'types' | 'people'>(
  queryClient: QueryClient,
  list: K,
  saved: Planning[K][number],
) {
  queryClient.setQueryData<Planning>(PLANNING_KEY, (was) => {
    if (!was) return was
    const items: { id: string }[] = was[list]
    return {
      ...was,
      [list]: items.some((item) => item.id === saved.id)
        ? items.map((item) => (item.id === saved.id ? saved : item))
        : [...items, saved],
    }
  })
}

/** Puts a saved type into the cached list, in place or at the end. */
export function storeStageType(queryClient: QueryClient, saved: StageType) {
  store(queryClient, 'types', saved)
}

/** Puts a saved person into the cached list, in place or at the end. */
export function storePerson(queryClient: QueryClient, saved: Person) {
  store(queryClient, 'people', saved)
}

/** Splits "Web, Core" into teams, as the person's teams field takes them. */
export function parseTeams(text: string) {
  return [
    ...new Set(
      text
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, 10)
}
