import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { changeOnboarding, useOnboarding, type Onboarding } from '@/api/onboarding'
import { toastError } from '@/lib/toast'

// Lets the board settle before the highlight lands on it.
const AUTO_START_DELAY_MS = 800

let running = false

function markSeen(queryClient: QueryClient) {
  // Seen at once, so a board opened before the server answers does not start it again.
  queryClient.setQueryData<Onboarding>(['onboarding'], (was) => was && { ...was, tour_seen: true })
  changeOnboarding({ tour_seen: true })
    .then((state) => queryClient.setQueryData(['onboarding'], state))
    .catch(toastError)
}

/** Loads the tour on demand and runs it. */
export async function startTour(queryClient: QueryClient) {
  if (running) return
  running = true
  try {
    const { runTour } = await import('@/onboarding/tour')
    runTour(() => {
      running = false
      markSeen(queryClient)
    })
  } catch (error) {
    // A chunk that failed to load must not keep the tour from starting next time.
    running = false
    toastError(error as Error)
  }
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
