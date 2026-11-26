import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CardSources } from '@/canvas/Toolbar'

afterEach(() => vi.unstubAllGlobals())

function task(key: string) {
  return {
    source: 'linear',
    key: `acme/${key}`,
    state: 'ok',
    summary: `Task ${key}`,
    status_name: 'Todo',
    status_category: 'new',
    type_name: 'Issue',
    assignee_name: null,
    priority_name: null,
    updated: null,
    url: 'https://linear.app/acme/issue/ENG-1',
    fetched_at: '2026-11-26T07:00:00Z',
  }
}

function show(linear: 'set' | 'none', found: { total: number | null; more: boolean }) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/api/me/tracker') {
      return Response.json({
        provider: 'jira',
        base_url: 'https://jira.example.com',
        tokens: { jira: 'set', github: 'none', linear },
      })
    }
    if (url === '/api/me/caldav') return Response.json({ state: 'none' })
    if (url.startsWith('/api/jql/'))
      return Response.json({ fields: [], functions: [], keywords: [] })
    return Response.json({ tasks: [task('ENG-1'), task('ENG-2')], estimated: false, ...found })
  })
  vi.stubGlobal('fetch', fetchMock)
  const onAdd = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CardSources onAdd={onAdd} onDone={vi.fn()} />
    </QueryClientProvider>,
  )
  return { fetchMock, onAdd }
}

test('a Linear tab sends its query to Linear and says when more match', async () => {
  const { fetchMock, onAdd } = show('set', { total: null, more: true })
  fireEvent.click(await screen.findByRole('radio', { name: 'Linear' }))
  const field = screen.getByLabelText('Issue keys, links or JQL')
  fireEvent.change(field, { target: { value: 'team = ENG' } })
  fireEvent.submit(field)
  await waitFor(() => expect(onAdd).toHaveBeenCalled())
  const search = fetchMock.mock.calls.find(
    ([url, init]) => url === '/api/tasks/search' && JSON.parse(String(init?.body)).limit > 0,
  )
  expect(JSON.parse(String(search?.[1]?.body))).toEqual({
    jql: 'team = ENG',
    limit: 50,
    source: 'linear',
  })
  expect(
    await screen.findByText('Added 2; more match. Narrow the query to add the rest.'),
  ).toBeInTheDocument()
})

test('a saved Linear view link is a query in the Linear tab', async () => {
  const { fetchMock } = show('set', { total: 2, more: false })
  fireEvent.click(await screen.findByRole('radio', { name: 'Linear' }))
  const field = screen.getByLabelText('Issue keys, links or JQL')
  const link = 'https://linear.app/acme/view/my-cycle-0a1b2c3d4e5f'
  fireEvent.change(field, { target: { value: link } })
  fireEvent.submit(field)
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/tasks/search' && JSON.parse(String(init?.body)).jql === link,
      ),
    ).toBe(true),
  )
})

test('no Linear tab without a Linear key', async () => {
  show('none', { total: 2, more: false })
  await screen.findByLabelText('Issue keys, links or JQL')
  expect(screen.queryByRole('radio', { name: 'Linear' })).toBeNull()
})
