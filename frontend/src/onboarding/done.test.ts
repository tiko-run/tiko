import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { resetFocusStore, updateTimer } from '@/focus/store'
import { play } from '@/focus/timer'
import { onOnboardingDone } from '@/onboarding/done'
import { setTimerPanelOpen } from '@/timers/panel'

const seen: string[] = []
const stop = onOnboardingDone((item) => seen.push(item))
afterAll(stop)

afterEach(() => {
  seen.length = 0
  vi.unstubAllGlobals()
})

test('opening the timer list ticks its item, closing it does not', () => {
  setTimerPanelOpen(true)
  setTimerPanelOpen(false)
  expect(seen).toEqual(['timer_list'])
})

test('starting the focus timer ticks its item once', () => {
  resetFocusStore()
  updateTimer(play)
  updateTimer(play)
  expect(seen).toEqual(['focus'])
})
