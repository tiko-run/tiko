import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { setChecklistOpen } from '@/onboarding/checklist-open'
import { didOnboarding } from '@/onboarding/done'
import { GettingStarted } from '@/onboarding/GettingStarted'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  act(() => setChecklistOpen(false))
})

type State = { tour_seen: boolean; done: Record<string, string>; hidden: boolean }

function mount(state: State, demo = false) {
  let saved = state
  const fetch = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const change = JSON.parse(init.body as string)
      saved = {
        tour_seen: change.tour_seen ?? saved.tour_seen,
        hidden: change.hidden ?? saved.hidden,
        done: {
          ...Object.fromEntries((change.done ?? []).map((i: string) => [i, 'then'])),
          ...saved.done,
        },
      }
    }
    return new Response(JSON.stringify(saved), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GettingStarted demo={demo} />
    </QueryClientProvider>,
  )
  return fetch
}

const fresh = { tour_seen: true, done: {}, hidden: false }

function patches(fetch: ReturnType<typeof mount>) {
  return fetch.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(init!.body as string))
}

test('an item ticks itself when the person does it', async () => {
  const fetch = mount(fresh)
  const pill = await screen.findByRole('button', { name: 'Getting started, 0 of 8 done' })
  act(() => didOnboarding('set_timer'))
  await waitFor(() => expect(pill).toHaveAccessibleName('Getting started, 1 of 8 done'))
  await waitFor(() => expect(patches(fetch)).toEqual([{ done: ['set_timer'] }]))
  // Doing it again sends nothing.
  act(() => didOnboarding('set_timer'))
  expect(patches(fetch)).toHaveLength(1)
})

test('the list waits for the tour', async () => {
  const fetch = mount({ ...fresh, tour_seen: false })
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: /Getting started/ })).toBeNull()
})

test('show me walks the person through the item, and the tracker opens Settings', async () => {
  mount(fresh)
  fireEvent.click(await screen.findByRole('button', { name: /Getting started/ }))
  const list = screen.getByRole('list', { name: 'Getting started' })
  const gantt = within(list).getByText('Put a task into a Gantt chart').closest('li')!
  fireEvent.click(within(gantt).getByRole('button', { name: 'Show me' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Click Modules')
  act(() => setChecklistOpen(true))
  const tracker = within(screen.getByRole('list')).getByText('Connect your tracker').closest('li')!
  fireEvent.click(within(tracker).getByRole('button', { name: 'Show me' }))
  expect(new URLSearchParams(window.location.search).get('settings')).toBe('tracker')
})

test('hide removes the pill and saves it', async () => {
  const fetch = mount(fresh)
  fireEvent.click(await screen.findByRole('button', { name: /Getting started/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
  expect(screen.queryByRole('button', { name: /Getting started/ })).toBeNull()
  await waitFor(() => expect(patches(fetch)).toContainEqual({ hidden: true }))
})

test('a demo visitor has no tracker item', async () => {
  mount(fresh, true)
  expect(
    await screen.findByRole('button', { name: 'Getting started, 0 of 7 done' }),
  ).toBeInTheDocument()
})

test('with everything done the pill goes away by itself', async () => {
  const all = ['add_card', 'paste_link', 'search_filter', 'set_timer', 'timer_list', 'gantt_task']
  const fetch = mount({ ...fresh, done: Object.fromEntries(all.map((i) => [i, 'then'])) }, true)
  await screen.findByRole('button', { name: 'Getting started, 6 of 7 done' })
  act(() => didOnboarding('focus'))
  expect(await screen.findByRole('button', { name: /7 of 7/ })).toBeInTheDocument()
  await waitFor(() => expect(patches(fetch)).toContainEqual({ hidden: true }), { timeout: 4000 })
  expect(screen.queryByRole('button', { name: /Getting started/ })).toBeNull()
})

test('a finished list brought back from About stays', async () => {
  const all = ['add_card', 'paste_link', 'search_filter', 'set_timer', 'timer_list', 'gantt_task']
  const done = Object.fromEntries([...all, 'focus'].map((i) => [i, 'then']))
  const fetch = mount({ ...fresh, done }, true)
  await screen.findByRole('button', { name: 'Getting started, 7 of 7 done' })
  await new Promise((resolve) => setTimeout(resolve, 2600))
  expect(patches(fetch)).toEqual([])
  expect(screen.getByRole('button', { name: /7 of 7/ })).toBeInTheDocument()
})

test('an item done before the state loads is still saved, once', async () => {
  const fetch = mount(fresh)
  act(() => {
    didOnboarding('add_card')
    didOnboarding('add_card')
  })
  await screen.findByRole('button', { name: /Getting started/ })
  await waitFor(() => expect(patches(fetch)).toEqual([{ done: ['add_card'] }]))
})
