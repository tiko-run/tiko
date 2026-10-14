import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AboutButton } from '@/board/AboutButton'

afterEach(() => vi.unstubAllGlobals())

const RELEASES = 'https://github.com/tiko-run/tiko/releases/tag'

function release(version: string, level = 'feature') {
  return { version, url: `${RELEASES}/v${version}`, level }
}

function info(overrides: object = {}) {
  return {
    version: '2026.10.6',
    update_check: true,
    latest: null,
    update_available: false,
    level: null,
    newer: [],
    ...overrides,
  }
}

function renderWith(body: object, ...more: object[]) {
  const answers = [body, ...more]
  const fetch = vi.fn(
    async () => new Response(JSON.stringify(answers.shift() ?? body), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetch)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AboutButton />
    </QueryClientProvider>,
  )
  return fetch
}

test('shows the running version and project links', async () => {
  renderWith(info())
  fireEvent.click(screen.getByRole('button', { name: 'About tiko' }))
  expect(await screen.findByRole('link', { name: 'v2026.10.6' })).toHaveAttribute(
    'href',
    `${RELEASES}/v2026.10.6`,
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
  expect(screen.getByText('You are on the latest version')).toBeInTheDocument()
})

test('lists the missed releases with their levels', async () => {
  renderWith(
    info({
      latest: release('2026.11.2'),
      update_available: true,
      level: 'hotfix',
      newer: [release('2026.11.2'), release('2026.11.1', 'hotfix')],
    }),
  )
  fireEvent.click(await screen.findByRole('button', { name: 'About tiko, update available' }))
  expect(await screen.findByText('v2026.11.2 is available')).toBeInTheDocument()
  const list = screen.getByRole('list', { name: 'New releases' })
  expect(list).toHaveTextContent('v2026.11.2v2026.11.1Hotfix')
  expect(screen.getByRole('link', { name: 'v2026.11.1' })).toHaveAttribute(
    'href',
    `${RELEASES}/v2026.11.1`,
  )
  expect(screen.queryByText(/security fix/)).toBeNull()
})

test('marks a security update on the button and in the panel', async () => {
  renderWith(
    info({
      latest: release('2026.11.1', 'security'),
      update_available: true,
      level: 'security',
      newer: [release('2026.11.1', 'security')],
    }),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'About tiko, security update available' }),
  )
  expect(await screen.findByText('Includes a security fix. Update soon.')).toBeInTheDocument()
  expect(screen.getByText('Security')).toBeInTheDocument()
})

test('check now asks the server at once', async () => {
  const fetch = renderWith(
    info(),
    info({ latest: release('2026.11.1'), update_available: true, newer: [release('2026.11.1')] }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'About tiko' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Check now' }))
  expect(await screen.findByText('v2026.11.1 is available')).toBeInTheDocument()
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/version/check',
    expect.objectContaining({ method: 'POST' }),
  )
})

test('no check button when update checks are off', async () => {
  renderWith(info({ update_check: false }))
  fireEvent.click(screen.getByRole('button', { name: 'About tiko' }))
  expect(await screen.findByRole('link', { name: 'v2026.10.6' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull()
})
