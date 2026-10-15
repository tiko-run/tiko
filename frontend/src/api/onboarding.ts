import { useQuery, type QueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchJson } from '@/api/client'
import { toastError } from '@/lib/toast'

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

/** Shows a change at once, so the board does not wait for the server, then saves it. */
export function saveOnboarding(queryClient: QueryClient, change: OnboardingChange) {
  queryClient.setQueryData<Onboarding>(
    ['onboarding'],
    (was) =>
      was && {
        tour_seen: change.tour_seen ?? was.tour_seen,
        hidden: change.hidden ?? was.hidden,
        done: {
          ...Object.fromEntries((change.done ?? []).map((item) => [item, 'now'])),
          ...was.done,
        },
      },
  )
  changeOnboarding(change)
    .then((state) => queryClient.setQueryData(['onboarding'], state))
    .catch(toastError)
}
