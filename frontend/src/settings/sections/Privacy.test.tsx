import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Privacy } from '@/settings/sections/Privacy'

afterEach(() => vi.unstubAllGlobals())

const ping = { kind: 'ping', schema: 1, version: '2026.10.20', people: '2-5' }

function show(privacy: Record<string, unknown>) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT')
      return Response.json({ ...privacy, ...JSON.parse(String(init.body)) })
    return Response.json(privacy)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Privacy />
    </QueryClientProvider>,
  )
  return fetchMock
}

test('turns usage stats off', async () => {
  const fetchMock = show({ usage_stats: true, locked: [], next_ping: ping })
  const toggle = await screen.findByRole('switch', { name: 'Send daily usage counts' })
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/privacy',
      expect.objectContaining({ method: 'PUT', body: '{"usage_stats":false}' }),
    ),
  )
  await waitFor(() => expect(toggle).not.toBeChecked())
})

test('shows the exact next ping', async () => {
  show({ usage_stats: true, locked: [], next_ping: ping })
  fireEvent.click(await screen.findByRole('button', { name: 'Show what is sent' }))
  expect(screen.getByLabelText('Next ping')).toHaveTextContent('"people": "2-5"')
})

test('a switch set by the server is read-only', async () => {
  show({ usage_stats: false, locked: ['usage_stats'], next_ping: ping })
  expect(await screen.findByText('TIKO_USAGE_STATS')).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'Send daily usage counts' })).toBeDisabled()
})
