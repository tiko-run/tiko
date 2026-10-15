import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { saveOnboarding, useOnboarding } from '@/api/onboarding'
import { toastError } from '@/lib/toast'

// Lets the board settle before the highlight lands on it.
const AUTO_START_DELAY_MS = 800

let running = false

/** Loads the tour on demand and runs it. */
export async function startTour(queryClient: QueryClient) {
  if (running) return
  running = true
  try {
    const { runTour } = await import('@/onboarding/tour')
    runTour(() => {
      running = false
      saveOnboarding(queryClient, { tour_seen: true })
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
