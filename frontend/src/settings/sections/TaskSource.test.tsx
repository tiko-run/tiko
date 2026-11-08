import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TaskSource } from '@/settings/sections/TaskSource'

afterEach(() => vi.unstubAllGlobals())

const settings = {
  provider: 'jira',
  refresh_interval_s: 30,
  secret_key_configured: true,
  jira: {
    base_url: 'https://jira.example.com',
    token_state: 'set',
    kind: 'dc',
    start_field: 'customfield_10022',
  },
  public_links: true,
  locked: [],
}

function show(saved = settings) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings/jira/date-fields')
      return Response.json([
        { id: 'customfield_10015', name: 'Start date' },
        { id: 'customfield_10022', name: 'Target start' },
      ])
    return Response.json(init?.method === 'PUT' ? saved : settings)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskSource />
    </QueryClientProvider>,
  )
  return fetchMock
}

test('the chosen start field is shown by its name and saved with the form', async () => {
  const fetchMock = show()
  expect(await screen.findByText('Target start')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({ method: 'PUT' }),
    ),
  )
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
  expect(JSON.parse(String(put[1]!.body)).jira_start_field).toBe('customfield_10022')
})

test('a new Jira URL hides the field until it is saved', async () => {
  show()
  const url = await screen.findByLabelText('Base URL')
  fireEvent.change(url, { target: { value: 'https://other.example.com' } })
  expect(screen.queryByText('Start date field')).not.toBeInTheDocument()
})
