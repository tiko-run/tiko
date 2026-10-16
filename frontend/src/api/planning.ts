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

const planningSchema = z.object({
  enabled: z.boolean(),
  types: z.array(stageTypeSchema),
})
export type Planning = z.infer<typeof planningSchema>

export const PLANNING_KEY = ['planning']

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

export function usePlanningQuery(enabled = true) {
  return useQuery({ queryKey: PLANNING_KEY, queryFn: getPlanning, enabled, staleTime: 60_000 })
}

/** A hue no active type has yet, so a new type stands apart from the others. */
export function freeHue(types: StageType[]): Hue {
  const active = types.filter((t) => !t.archived)
  const used = new Set(active.map((t) => t.hue))
  return HUES.find((h) => !used.has(h)) ?? HUES[active.length % HUES.length]
}

/** Puts a saved type into the cached list, in place or at the end. */
export function storeStageType(queryClient: QueryClient, saved: StageType) {
  queryClient.setQueryData<Planning>(
    PLANNING_KEY,
    (was) =>
      was && {
        ...was,
        types: was.types.some((t) => t.id === saved.id)
          ? was.types.map((t) => (t.id === saved.id ? saved : t))
          : [...was.types, saved],
      },
  )
}
