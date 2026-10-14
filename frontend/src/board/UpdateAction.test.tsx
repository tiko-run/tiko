import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ReleaseLevel, VersionInfo } from '@/api/version'
import { UpdateAction } from '@/board/UpdateAction'
import { UpdatedNotice, UpdateProgress } from '@/board/UpdateProgress'

const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('sonner', () => ({ toast }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const idle = {
  state: 'idle',
  step: null,
  target: null,
  downloaded: 0,
  total: 0,
  error: null,
  log: [],
}

function info(level: ReleaseLevel = 'feature'): VersionInfo {
  const release = { version: '2026.11.1', url: 'https://example.test/r', level } as const
  return {
    version: '2026.10.6',
    update_check: true,
    latest: release,
    update_available: true,
    level: release.level,
    newer: [release],
  }
}

type Route = (init?: RequestInit) => unknown

function serve(routes: Record<string, Route | unknown>) {
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const route = routes[path]
    const body = typeof route === 'function' ? (route as Route)(init) : route
    if (body instanceof Error) throw body
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function renderWith(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  )
}

test('an admin starts the update', async () => {
  const fetch = serve({
    '/api/update': (init?: RequestInit) => ({
      available: true,
      hosting: null,
      status: init?.method === 'POST' ? { ...idle, state: 'running', target: '2026.11.1' } : idle,
    }),
  })
  renderWith(<UpdateAction info={info()} admin />)
  fireEvent.click(await screen.findByRole('button', { name: 'Update now' }))
  expect(await screen.findByText('Updating to v2026.11.1…')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/update', expect.objectContaining({ method: 'POST' }))
})

test('a breaking update asks first', async () => {
  const fetch = serve({ '/api/update': { available: true, hosting: null, status: idle } })
  renderWith(<UpdateAction info={info('breaking')} admin />)
  fireEvent.click(await screen.findByRole('button', { name: 'Update now' }))
  expect(screen.getByRole('link', { name: 'Read the notes' })).toHaveAttribute(
    'href',
    'https://example.test/r',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument()
})

test('a member is sent to an admin', async () => {
  serve({ '/api/update': { available: true, hosting: null, status: idle } })
  renderWith(<UpdateAction info={info()} admin={false} />)
  expect(await screen.findByText('Ask an admin to update.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull()
})

test('without the updater it says how to update by hand', async () => {
  serve({ '/api/update': { available: false, hosting: 'railway', status: null } })
  renderWith(<UpdateAction info={info()} admin />)
  expect(await screen.findByText('Redeploy tiko on Railway to update.')).toBeInTheDocument()
})

test('a failed update shows its log', async () => {
  const failed = { ...idle, state: 'failed', error: 'health check failed', log: ['Rolling back'] }
  serve({ '/api/update': { available: true, hosting: null, status: failed } })
  renderWith(<UpdateAction info={info()} admin />)
  expect(await screen.findByText('The last update failed: health check failed')).toBeInTheDocument()
  expect(screen.getByText('Rolling back')).toBeInTheDocument()
})

test('progress follows the download, then reloads once the update is done', async () => {
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  let phase = 'download'
  const running = { ...idle, state: 'running', step: 'download', target: '2026.11.1' }
  serve({
    '/api/update': () => {
      if (phase === 'download') {
        return {
          available: true,
          hosting: null,
          status: { ...running, downloaded: 30, total: 120 },
        }
      }
      if (phase === 'restart') return new Error('api restarting')
      return { available: true, hosting: null, status: { ...running, state: 'done', step: 'done' } }
    },
    '/api/version': { ...info(), version: '2026.11.1' },
  })
  renderWith(<UpdateProgress />)
  expect(await screen.findByText('Downloading the new version · 25%')).toBeInTheDocument()
  phase = 'restart'
  await act(() => new Promise((resolve) => setTimeout(resolve, 1700)))
  expect(
    await screen.findByText('Restarting tiko. The page reloads by itself.'),
  ).toBeInTheDocument()
  expect(reload).not.toHaveBeenCalled()
  phase = 'done'
  await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 5000 })
}, 12_000)

test('nothing shows when no update runs', async () => {
  const fetch = serve({ '/api/update': { available: true, hosting: null, status: idle } })
  const { container } = renderWith(<UpdateProgress />)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(container).toBeEmptyDOMElement()
})

test('other pages learn about the new version', async () => {
  let version = '2026.10.6'
  serve({ '/api/version': () => ({ ...info(), version }) })
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <UpdatedNotice />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(client.getQueryData(['version', 'running'])).toBeTruthy())
  expect(toast).not.toHaveBeenCalled()
  version = '2026.11.1'
  await act(() => client.refetchQueries({ queryKey: ['version', 'running'] }))
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      'tiko was updated to v2026.11.1',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Reload' }) }),
    ),
  )
})
