import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AboutButton } from '@/board/AboutButton'

afterEach(() => vi.unstubAllGlobals())

function renderWith(body: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AboutButton />
    </QueryClientProvider>,
  )
}

test('shows the running version and project links', async () => {
  renderWith({ version: '2026.10.6', latest: null, update_available: false })
  fireEvent.click(screen.getByRole('button', { name: 'About tiko' }))
  expect(await screen.findByRole('link', { name: 'v2026.10.6' })).toHaveAttribute(
    'href',
    'https://github.com/tiko-run/tiko/releases/tag/v2026.10.6',
  )
  expect(screen.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
    'href',
    'https://github.com/tiko-run/tiko',
  )
  expect(screen.getByRole('link', { name: 'Report a bug or idea' })).toHaveAttribute(
    'href',
    'https://github.com/tiko-run/tiko/issues/new/choose',
  )
  expect(screen.queryByText(/is available/)).toBeNull()
})

test('flags a newer release on the button and in the panel', async () => {
  renderWith({
    version: '2026.10.6',
    latest: {
      version: '2026.11.1',
      url: 'https://github.com/tiko-run/tiko/releases/tag/v2026.11.1',
    },
    update_available: true,
  })
  fireEvent.click(await screen.findByRole('button', { name: 'About tiko, update available' }))
  expect(await screen.findByText('v2026.11.1 is available')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: "See what's new" })).toHaveAttribute(
    'href',
    'https://github.com/tiko-run/tiko/releases/tag/v2026.11.1',
  )
})
