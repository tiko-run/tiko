import { afterEach, expect, test, vi } from 'vitest'
import { saveTrackerToken } from '@/api/settings'
import { resetFocusStore, updateTimer } from '@/focus/store'
import { play } from '@/focus/timer'
import { onOnboardingDone } from '@/onboarding/done'
import { setTimerPanelOpen } from '@/timers/panel'

const seen: string[] = []
const stop = onOnboardingDone((item) => seen.push(item))

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

test('a saved tracker token ticks its item', async () => {
  const tracker = {
    provider: 'jira',
    base_url: null,
    token_state: 'set',
    github_token_state: 'none',
  }
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(tracker), { status: 200 }))
  await saveTrackerToken('made-up-token')
  expect(seen).toEqual(['tracker'])
  stop()
})
