import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchJson } from '@/api/client'

export const ITEMS = [
  'add_card',
  'paste_link',
  'search_filter',
  'set_timer',
  'timer_list',
  'gantt_task',
  'focus',
  'tracker',
] as const
export type Item = (typeof ITEMS)[number]

const onboardingSchema = z.object({
  tour_seen: z.boolean(),
  done: z.partialRecord(z.enum(ITEMS), z.string()),
  hidden: z.boolean(),
})
export type Onboarding = z.infer<typeof onboardingSchema>

export type OnboardingChange = { tour_seen?: boolean; done?: Item[]; hidden?: boolean }

export function getOnboarding() {
  return fetchJson('/api/me/onboarding', onboardingSchema)
}

export function changeOnboarding(change: OnboardingChange) {
  return fetchJson('/api/me/onboarding', onboardingSchema, {
    method: 'PATCH',
    body: JSON.stringify(change),
  })
}

export function useOnboarding(enabled = true) {
  return useQuery({
    queryKey: ['onboarding'],
    queryFn: getOnboarding,
    staleTime: Infinity,
    enabled,
  })
}
