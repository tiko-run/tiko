import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CalDavPicker } from '@/canvas/CalDavPicker'

afterEach(() => vi.unstubAllGlobals())

const HOME = 'https://cloud.example.com/dav/home/'

function task(key: string, summary: string, list = 'Home', done = false) {
  return {
    source: 'caldav',
    key,
    state: 'ok',
    summary,
    status_name: done ? 'Done' : 'To do',
    status_category: done ? 'done' : 'new',
    type_name: list,
    assignee_name: null,
    priority_name: null,
    updated: null,
    url: '',
    fetched_at: '2026-11-08T10:00:00+00:00',
  }
}

const ALL = [
  task('t-1', 'Buy milk'),
  task('t-2', 'Call the plumber'),
  task('t-3', 'Buy a chair', 'Work'),
]

function show() {
  const onAdd = vi.fn()
  const onDone = vi.fn()
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/me/caldav')
      return Response.json({ state: 'set', address: 'https://cloud.example.com/', username: 'ann' })
    if (url === '/api/me/caldav/lists')
      return Response.json({
        lists: [
          { id: HOME, name: 'Home', color: '', shown: true },
          { id: 'hidden', name: 'Hidden', color: '', shown: false },
        ],
      })
    const { query, done } = JSON.parse(String(init?.body))
    const tasks = [...ALL, ...(done ? [task('t-4', 'Old one', 'Home', true)] : [])].filter((t) =>
      t.summary.toLowerCase().includes(query.toLowerCase()),
    )
    return Response.json({ tasks, total: tasks.length + (query ? 0 : 300) })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CalDavPicker onAdd={onAdd} onDone={onDone} />
    </QueryClientProvider>,
  )
  return { onAdd, onDone, fetchMock }
}

function bodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/tasks/caldav')
    .map(([, init]) => JSON.parse(String(init?.body)))
}

test('names the account and says how many more tasks a search would reach', async () => {
  show()
  expect(await screen.findByText('ann on cloud.example.com')).toBeVisible()
  expect(await screen.findByText(/And 300 more/)).toBeVisible()
})

test('searches every list by title and keeps ticks across searches', async () => {
  const { onAdd, fetchMock } = show()
  fireEvent.click(await screen.findByRole('checkbox', { name: /Call the plumber/ }))
  fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'buy' } })
  await waitFor(() => expect(screen.queryByText('Call the plumber')).toBeNull())
  expect(bodies(fetchMock).at(-1)).toEqual({ query: 'buy', list_id: null, done: false })
  fireEvent.click(screen.getByRole('checkbox', { name: /Buy a chair/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Add 2' }))
  expect(onAdd.mock.calls[0][0].map((t: { key: string }) => t.key)).toEqual(['t-2', 't-3'])
})

test('shows done tasks when asked and adds what is shown', async () => {
  const { onAdd } = show()
  await screen.findByText('Buy milk')
  fireEvent.click(screen.getByLabelText('Show done'))
  expect(await screen.findByText('Old one')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Add these 4' }))
  expect(onAdd.mock.calls[0][0]).toHaveLength(4)
})
