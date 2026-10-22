import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { saveOnboarding, useOnboarding } from '@/api/onboarding'
import { useAddressBoard } from '@/lib/navigation'
import { toastError } from '@/lib/toast'

// Lets the board settle before the highlight lands on it.
const AUTO_START_DELAY_MS = 800

let running = false
// Boards made with "New board" in this tab: their name is being typed and they have no cards yet.
const madeHere = new Set<string>()

/** Keeps the tour from starting by itself on a board the person has just made. */
export function holdTourOn(board: string) {
  madeHere.add(board)
}

/** The person moved on: a board made earlier is no longer new. */
export function releaseTourHolds(except?: string | null) {
  for (const board of madeHere) if (board !== except) madeHere.delete(board)
}

/** Loads the tour on demand and runs it. */
export async function startTour(queryClient: QueryClient, wanted: () => boolean = () => true) {
  if (running) return
  running = true
  try {
    const { runTour } = await import('@/onboarding/tour')
    // The person may have left the board while the tour was loading.
    if (!wanted()) {
      running = false
      return
    }
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
  const board = useAddressBoard()
  useEffect(() => {
    releaseTourHolds(board)
    if (seen !== false || (board && madeHere.has(board))) return
    let left = false
    const timer = setTimeout(() => void startTour(queryClient, () => !left), AUTO_START_DELAY_MS)
    return () => {
      left = true
      clearTimeout(timer)
    }
  }, [seen, board, queryClient])
}
