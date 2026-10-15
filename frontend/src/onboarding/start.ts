import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { changeOnboarding, useOnboarding, type Onboarding } from '@/api/onboarding'
import type { StepId } from '@/onboarding/tour'

// Lets the board settle before the highlight lands on it.
const AUTO_START_DELAY_MS = 800

let running = false

/** Loads the tour on demand and runs it, or one step of it. */
export async function startTour(queryClient: QueryClient, only?: StepId) {
  if (running) return
  running = true
  const { runTour } = await import('@/onboarding/tour')
  runTour(only, () => {
    running = false
    if (only) return
    // Seen at once, so a board opened before the server answers does not start it again.
    queryClient.setQueryData<Onboarding>(
      ['onboarding'],
      (was) => was && { ...was, tour_seen: true },
    )
    void changeOnboarding({ tour_seen: true }).then((state) =>
      queryClient.setQueryData(['onboarding'], state),
    )
  })
}

/** Starts the tour once for a person who has not seen it; mounted only on an editable board. */
export function useAutoTour() {
  const queryClient = useQueryClient()
  const seen = useOnboarding().data?.tour_seen
  useEffect(() => {
    if (seen !== false) return
    const timer = setTimeout(() => void startTour(queryClient), AUTO_START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [seen, queryClient])
}
