import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CalDavPicker } from '@/canvas/CalDavPicker'

afterEach(() => vi.unstubAllGlobals())

const PERSONAL = 'https://cloud.example.com/dav/personal/'

function task(key: string, summary: string, done = false) {
  return {
    source: 'caldav',
    key,
    state: 'ok',
    summary,
    status_name: done ? 'Done' : 'To do',
    status_category: done ? 'done' : 'new',
    type_name: 'Personal',
    assignee_name: null,
    priority_name: null,
    updated: null,
    url: '',
    fetched_at: '2026-11-08T10:00:00+00:00',
  }
}

function show() {
  const onAdd = vi.fn()
  const onDone = vi.fn()
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/me/caldav/lists')
      return Response.json({
        lists: [
          { id: PERSONAL, name: 'Personal', color: '', shown: true },
          { id: 'hidden', name: 'Hidden', color: '', shown: false },
        ],
      })
    const done = JSON.parse(String(init?.body)).done
    const tasks = [task('t-1', 'Buy milk'), task('t-2', 'Call the plumber')]
    return Response.json({
      tasks: done ? [...tasks, task('t-3', 'Old one', true)] : tasks,
      total: done ? 3 : 2,
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CalDavPicker onAdd={onAdd} onDone={onDone} />
    </QueryClientProvider>,
  )
  return { onAdd, onDone, fetchMock }
}

test('adds the ticked tasks of the first shown list', async () => {
  const { onAdd, onDone } = show()
  expect(screen.queryByRole('radio', { name: 'Hidden' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Call the plumber' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add 1' }))
  expect(onAdd.mock.calls[0][0].map((t: { key: string }) => t.key)).toEqual(['t-2'])
  expect(onDone).toHaveBeenCalled()
})

test('adds a whole list, with done tasks when asked', async () => {
  const { onAdd } = show()
  await screen.findByText('Buy milk')
  fireEvent.click(screen.getByLabelText('Show done'))
  expect(await screen.findByText('Old one')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Add all' }))
  expect(onAdd.mock.calls[0][0]).toHaveLength(3)
})
