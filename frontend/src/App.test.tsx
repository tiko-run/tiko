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

// The canvas needs a real browser; these tests only follow which board is open.
vi.mock('@/canvas/Canvas', () => ({
  default: ({ boardId }: { boardId: string }) => <p>Canvas of {boardId}</p>,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

test('offers to create the first board', async () => {
  mockFetch(200, { boards: [], all: [] })
  renderApp()
  expect(await screen.findByText(/No boards yet/)).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /New board/ })[0]).toBeEnabled()
})

const me = {
  id: 'u1',
  username: 'ann',
  name: 'Ann',
  role: 'member',
  server_admin: false,
  workspace: { id: 'w1', name: 'Default' },
}
const summary = (id: string, name: string) => ({
  id,
  name,
  created_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-10-20T09:00:00Z',
  my_role: 'owner',
  owner: { id: 'u1', name: 'Ann' },
  public: false,
})
const signedIn = { '/api/auth/status': { status: 200, body: { signed_in: true, me } } }
const address = () => new URL(window.location.href).searchParams.get('board')

test('lands on Home without a board in the address, and Back and Forward move between them', async () => {
  window.history.replaceState(null, '', '/')
  mockFetch(200, { boards: [summary('b1', 'Roadmap'), summary('b2', 'Sprint')], all: [] }, signedIn)
  renderApp()
  fireEvent.click(await screen.findByRole('link', { name: /Sprint/ }))
  expect(address()).toBe('b2')
  expect(await screen.findByText('Canvas of b2')).toBeInTheDocument()
  await act(async () => {
    window.history.back()
    await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }))
  })
  expect(address()).toBeNull()
  expect(await screen.findByRole('heading', { name: 'Boards' })).toBeInTheDocument()
  await act(async () => {
    window.history.forward()
    await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }))
  })
  expect(await screen.findByText('Canvas of b2')).toBeInTheDocument()
})

test('a board link opens the board without Home in between', async () => {
  window.history.replaceState(null, '', '/?board=b1')
  mockFetch(200, { boards: [summary('b1', 'Roadmap')], all: [] }, signedIn)
  renderApp()
  expect(await screen.findByText('Canvas of b1')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Boards' })).toBeNull()
})

test('Try the demo opens the welcome board, with Home one step back', async () => {
  window.history.replaceState(null, '', '/demo')
  let started = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/auth/demo') {
        started = true
        return new Response(null, { status: 204 })
      }
      if (path === '/api/auth/status')
        return Response.json({ signed_in: started, me: started ? me : null, demo: true })
      return Response.json({ boards: [summary('w1', 'Welcome to tiko')], all: [] })
    }),
  )
  renderApp()
  fireEvent.click(await screen.findByRole('button', { name: /Try the demo/ }))
  expect(await screen.findByText('Canvas of w1')).toBeInTheDocument()
  await act(async () => {
    window.history.back()
    await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }))
  })
  expect(await screen.findByRole('heading', { name: 'Boards' })).toBeInTheDocument()
  expect(window.location.pathname).toBe('/')
})

test('a link to a board that is gone lands on Home and says so', async () => {
  window.history.replaceState(null, '', '/?board=gone')
  mockFetch(200, { boards: [summary('b1', 'Roadmap')], all: [] }, signedIn)
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Boards' })).toBeInTheDocument()
  expect(address()).toBeNull()
})

test('shows the unified API error message', async () => {
  mockFetch(503, { error: { code: 'dependency_unavailable', message: 'database is down' } })
  renderApp()
  expect(await screen.findByText('database is down')).toBeInTheDocument()
})

test('asks for username and password and opens the boards after signing in', async () => {
  const me = {
    id: 'u1',
    username: 'admin',
    name: 'Admin',
    role: 'admin',
    server_admin: true,
    workspace: { id: 'w1', name: 'Default' },
  }
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
  expect(await screen.findByText(/No boards yet/)).toBeInTheDocument()
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
  await screen.findByText(/No boards yet/)
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
  await screen.findByText(/No boards yet/)
  act(() => {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
  })
  expect(await screen.findByRole('link', { name: 'Try the demo' })).toBeInTheDocument()
})

test.each([
  ['server admin', true],
  ['workspace admin', false],
])('security banner for %s: %s', async (role, shown) => {
  localStorage.clear()
  const release = {
    version: '2026.11.1',
    url: 'https://example.test/r',
    level: 'security',
    installer: false,
  }
  mockFetch(
    200,
    { boards: [], all: [] },
    {
      '/api/auth/status': {
        status: 200,
        body: {
          signed_in: true,
          me: {
            id: 'u1',
            username: 'ann',
            name: 'Ann',
            role: 'admin',
            server_admin: role === 'server admin',
            workspace: { id: 'w1', name: 'Default' },
          },
        },
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
          installer: false,
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

test('shows no focus timer until the session is known', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  )
  renderApp()
  await act(async () => undefined)
  expect(screen.queryByLabelText('Focus timer')).not.toBeInTheDocument()
})

test('someone removed from the workspace sees how to come back, and no boards', async () => {
  const me = {
    id: 'u2',
    username: 'ann',
    name: 'Ann Lee',
    role: null,
    server_admin: false,
    workspace: null,
  }
  const fetch = mockFetch(
    200,
    { boards: [], all: [] },
    {
      '/api/auth/status': { status: 200, body: { signed_in: true, me } },
    },
  )
  renderApp()
  expect(await screen.findByText('You are not in a workspace.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  expect(fetch.mock.calls.map(([path]) => path)).not.toContain('/api/boards')
})
