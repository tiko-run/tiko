import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import App from './App'
import { AUTH_REQUIRED_EVENT } from '@/api/client'

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

type Reply = { status: number; body: unknown }

// The boards reply stands for every route except the auth ones.
function mockFetch(status: number, body: unknown, auth: Partial<Record<string, Reply>> = {}) {
  const routes: Record<string, Reply> = {
    '/api/auth/status': { status: 200, body: { signed_in: true, me: null } },
    ...auth,
  }
  const fetch = vi.fn(async (path: string) => {
    const reply = routes[path] ?? { status, body }
    return new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
      status: reply.status,
    })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

test('offers to create the first board', async () => {
  mockFetch(200, { boards: [], all: [] })
  renderApp()
  expect(await screen.findByText(/Create a board/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /New board/ })).toBeDisabled()
})

test('shows the unified API error message', async () => {
  mockFetch(503, { error: { code: 'dependency_unavailable', message: 'database is down' } })
  renderApp()
  expect(await screen.findByText('database is down')).toBeInTheDocument()
})

test('asks for username and password and opens the boards after signing in', async () => {
  const me = { id: 'u1', username: 'admin', name: 'Admin', role: 'admin' }
  let signedIn = false
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/auth/login') {
      expect(JSON.parse(String(init?.body))).toEqual({ username: 'admin', password: 'pw' })
      signedIn = true
      return new Response(null, { status: 204 })
    }
    if (path === '/api/auth/status')
      return Response.json({ signed_in: signedIn, me: signedIn ? me : null })
    return Response.json({ boards: [], all: [] })
  })
  vi.stubGlobal('fetch', fetch)
  renderApp()
  const password = await screen.findByLabelText('Password')
  expect(fetch.mock.calls.map(([path]) => path)).not.toContain('/api/boards')
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' admin ' } })
  fireEvent.change(password, { target: { value: 'pw' } })
  fireEvent.click(screen.getByRole('button', { name: /Sign in/ }))
  expect(await screen.findByText(/Create a board/)).toBeInTheDocument()
})

test('names wrong credentials', async () => {
  mockFetch(
    200,
    { boards: [], all: [] },
    {
      '/api/auth/status': { status: 200, body: { signed_in: false, me: null } },
      '/api/auth/login': {
        status: 401,
        body: { error: { code: 'invalid_credentials', message: 'wrong' } },
      },
    },
  )
  renderApp()
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } })
  fireEvent.click(screen.getByRole('button', { name: /Sign in/ }))
  expect(await screen.findByText('Wrong username or password.')).toBeInTheDocument()
})

test('drops back to the sign-in screen when the session is gone', async () => {
  mockFetch(200, { boards: [], all: [] })
  renderApp()
  await screen.findByText(/Create a board/)
  act(() => {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
  })
  expect(await screen.findByLabelText('Password')).toBeInTheDocument()
})

test('keeps the way into the demo when a visitor is signed out', async () => {
  mockFetch(
    200,
    { boards: [], all: [] },
    { '/api/auth/status': { status: 200, body: { signed_in: true, me: null, demo: true } } },
  )
  renderApp()
  await screen.findByText(/Create a board/)
  act(() => {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
  })
  expect(await screen.findByRole('link', { name: 'Try the demo' })).toBeInTheDocument()
})

test.each([
  ['admin', true],
  ['member', false],
])('security banner for %s: %s', async (role, shown) => {
  localStorage.clear()
  const release = { version: '2026.11.1', url: 'https://example.test/r', level: 'security' }
  mockFetch(
    200,
    { boards: [], all: [] },
    {
      '/api/auth/status': {
        status: 200,
        body: { signed_in: true, me: { id: 'u1', username: 'ann', name: 'Ann', role } },
      },
      '/api/version': {
        status: 200,
        body: {
          version: '2026.10.6',
          update_check: true,
          latest: release,
          update_available: true,
          level: 'security',
          newer: [release],
        },
      },
    },
  )
  renderApp()
  // The About dot comes from the same answer, so once it shows the banner has had its chance.
  expect(
    await screen.findByRole('button', { name: 'About tiko, security update available' }),
  ).toBeInTheDocument()
  expect(screen.queryByText('Security update available') !== null).toBe(shown)
})
