import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { SettingsDialog } from '@/settings/SettingsDialog'
import { openSettings, type Section } from '@/settings/store'

const settings = {
  provider: 'demo',
  refresh_interval_s: 30,
  secret_key_configured: true,
  jira: { base_url: null, token_state: 'none' },
  public_links: true,
}
const admin = {
  id: 'u1',
  username: 'admin',
  name: 'Admin',
  role: 'admin',
  server_admin: true,
  workspace: { id: 'w1', name: 'Default' },
}

// jsdom lacks pointer capture, which a toast takes when pressed.
Element.prototype.setPointerCapture ??= () => {}

afterEach(() => {
  act(() => openSettings(null))
  vi.unstubAllGlobals()
})

function mockApi(
  replies: Record<string, (init?: RequestInit) => Response> = {},
  me: typeof admin = admin,
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (replies[url]) return replies[url](init)
    if (url === '/api/auth/status') return Response.json({ signed_in: true, me })
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    return Response.json({ ...settings, ...body })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function show(section: Section = 'profile') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsDialog />
      <Toaster />
    </QueryClientProvider>,
  )
  act(() => openSettings(section))
}

function callTo(fetchMock: ReturnType<typeof mockApi>, url: string) {
  const call = fetchMock.mock.calls.find(([path, init]) => path === url && init?.method)
  return call && { method: call[1]?.method, body: JSON.parse(String(call[1]?.body)) }
}

test('opens on Profile and renames me', async () => {
  const fetchMock = mockApi({
    '/api/me': (init) => Response.json({ ...admin, ...JSON.parse(String(init?.body)) }),
  })
  show()
  const name = await screen.findByLabelText('Name')
  expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled()
  fireEvent.change(name, { target: { value: 'Ann ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
  const saved = await screen.findByText('Profile saved')
  // A toast sits outside the window; a press on it is not a press past the window.
  fireEvent.pointerDown(saved)
  fireEvent.click(saved)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(callTo(fetchMock, '/api/me')).toEqual({
    method: 'PATCH',
    body: { name: 'Ann', username: 'admin' },
  })
})

test('keeps the section in the URL and drops it on close', async () => {
  mockApi()
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Security' }))
  expect(await screen.findByLabelText('Current password')).toBeInTheDocument()
  expect(new URL(window.location.href).searchParams.get('settings')).toBe('security')
  expect(screen.getByRole('button', { name: 'Security' })).toHaveAttribute('aria-current', 'page')
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(new URL(window.location.href).searchParams.has('settings')).toBe(false)
})

test('a member gets Stages and people of the workspace and opens Profile instead of the rest', async () => {
  mockApi({}, { ...admin, role: 'member', server_admin: false })
  show('task-source')
  expect(await screen.findByLabelText('Name')).toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: 'Settings sections' })
  expect(nav).toHaveTextContent('Stages and people')
  for (const hidden of ['Task source', 'People', 'Sharing', 'Server', 'Privacy', 'Accounts']) {
    expect(nav).not.toHaveTextContent(hidden)
  }
})

test('a workspace admin gets the workspace group and no server group', async () => {
  mockApi({}, { ...admin, server_admin: false })
  show('accounts')
  expect(await screen.findByLabelText('Name')).toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: 'Settings sections' })
  for (const shown of ['Workspace', 'Task source', 'People', 'Sharing']) {
    expect(nav).toHaveTextContent(shown)
  }
  for (const hidden of ['Server', 'Privacy', 'Accounts']) {
    expect(nav).not.toHaveTextContent(hidden)
  }
})

test('the server admin gets Privacy and Accounts under Server', async () => {
  mockApi()
  show()
  const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
  expect(nav).toHaveTextContent(/Account.*Workspace.*Server/)
  expect(screen.getByRole('button', { name: 'Privacy' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Accounts' })).toBeInTheDocument()
})

test('names a wrong current password', async () => {
  mockApi({
    '/api/me/password': () =>
      Response.json(
        { error: { code: 'invalid_credentials', message: 'The current password is wrong.' } },
        { status: 401 },
      ),
  })
  show('security')
  fireEvent.change(await screen.findByLabelText('Current password'), {
    target: { value: 'old-password' },
  })
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'new-password-1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
  expect(await screen.findByText('The current password is wrong.')).toBeInTheDocument()
})

test('switches the theme at once', async () => {
  mockApi()
  show('preferences')
  fireEvent.click(await screen.findByLabelText('Dark'))
  expect(document.documentElement).toHaveClass('dark')
  fireEvent.click(screen.getByLabelText('Light'))
  expect(document.documentElement).not.toHaveClass('dark')
})

test('saves the refresh interval of the task source', async () => {
  const fetchMock = mockApi()
  show('task-source')
  const field = await screen.findByLabelText(/Refresh every/)
  fireEvent.change(field, { target: { value: '90' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() =>
    expect(callTo(fetchMock, '/api/settings')).toEqual({
      method: 'PUT',
      body: { provider: 'demo', refresh_interval_s: 90 },
    }),
  )
})

test('shows the tracker set by the server as read-only', async () => {
  mockApi({
    '/api/settings': () =>
      Response.json({
        ...settings,
        provider: 'jira',
        jira: { base_url: 'https://jira.example.com', token_state: 'none' },
        locked: ['provider', 'jira_base_url'],
      }),
  })
  show('task-source')
  expect(await screen.findByLabelText('Base URL')).toBeDisabled()
  expect(screen.getByText('JIRA_BASE_URL')).toBeInTheDocument()
  expect(screen.getByText('TIKO_TRACKER')).toBeInTheDocument()
  expect(screen.getByLabelText('Demo tasks (DEMO-1 to DEMO-12)')).toBeDisabled()
})

test('an admin switches public links off for the instance', async () => {
  const fetchMock = mockApi()
  show('sharing')
  const toggle = await screen.findByRole('switch', { name: 'Board owners can make a public link' })
  await waitFor(() => expect(toggle).toBeChecked())
  fireEvent.click(toggle)
  await waitFor(() =>
    expect(callTo(fetchMock, '/api/settings')).toEqual({
      method: 'PUT',
      body: { public_links: false },
    }),
  )
  await waitFor(() => expect(toggle).not.toBeChecked())
})

test('a demo visitor gets no Profile, Security or My tracker, and plans in their own lists', async () => {
  const visitor = {
    id: 'u9',
    username: '~0a1b2c3d4e5f',
    name: 'Demo visitor',
    role: 'member',
    server_admin: false,
    workspace: { id: 'w1', name: 'Default' },
    demo_expires_at: '2026-10-18T10:00:00+00:00',
  }
  mockApi({}, visitor)
  show()
  const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
  expect(nav).toHaveTextContent('Preferences')
  expect(nav).toHaveTextContent('Stages and people')
  for (const hidden of ['Profile', 'Security', 'My tracker']) {
    expect(nav).not.toHaveTextContent(hidden)
  }
})
