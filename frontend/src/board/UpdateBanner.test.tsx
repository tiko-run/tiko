import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { UpdateBanner } from '@/board/UpdateBanner'

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function renderWith(level: string | null) {
  const latest = { version: '2026.11.1', url: 'https://example.test/v2026.11.1', level: 'feature' }
  const body = {
    version: '2026.10.6',
    update_check: true,
    latest: level ? latest : null,
    update_available: level !== null,
    level,
    newer: level ? [latest] : [],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  )
  const client = new QueryClient()
  const view = render(
    <QueryClientProvider client={client}>
      <UpdateBanner />
    </QueryClientProvider>,
  )
  const loaded = () =>
    waitFor(() => expect(client.getQueryState(['version'])?.status).toBe('success'))
  return { ...view, loaded }
}

test('shows for a security update', async () => {
  renderWith('security')
  expect(await screen.findByText('Security update available')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: "See what's new" })).toHaveAttribute(
    'href',
    'https://example.test/v2026.11.1',
  )
})

test('stays hidden for other levels', async () => {
  const { container, loaded } = renderWith('breaking')
  await loaded()
  expect(container).toBeEmptyDOMElement()
})

test('closes for a day, then comes back', async () => {
  const view = renderWith('security')
  fireEvent.click(await screen.findByRole('button', { name: 'Remind me tomorrow' }))
  expect(screen.queryByText('Security update available')).toBeNull()
  view.unmount()

  const again = renderWith('security')
  await again.loaded()
  expect(screen.queryByText('Security update available')).toBeNull()
  again.unmount()

  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + 24 * 3600_000 + 1)
  renderWith('security')
  expect(await screen.findByText('Security update available')).toBeInTheDocument()
})
