import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { Accounts } from '@/settings/sections/Accounts'

const me = {
  id: 'u1',
  username: 'admin',
  name: 'Admin',
  role: 'admin' as const,
  server_admin: true,
  workspace: { id: 'w1', name: 'Default' },
}
const account = {
  id: 'u1',
  username: 'admin',
  name: 'Admin',
  server_admin: true,
  disabled: false,
  in_workspace: true,
  last_sign_in_at: null,
  created_at: '2026-10-08T10:00:00+00:00',
}
const dan = {
  ...account,
  id: 'u2',
  username: 'dan',
  name: 'Dan Example',
  server_admin: false,
  in_workspace: false,
}
const reset = {
  id: 'i2',
  kind: 'reset',
  role: null,
  username: 'dan',
  expires_at: '2026-10-21T10:00:00+00:00',
  created_at: '2026-10-20T10:00:00+00:00',
}

afterEach(() => vi.unstubAllGlobals())

function mockApi() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/accounts') return Response.json({ accounts: [account, dan] })
    if (url === '/api/accounts/u2' && init?.method === 'PATCH')
      return Response.json({ ...dan, ...JSON.parse(String(init.body)) })
    if (url === '/api/accounts/u2/reset')
      return Response.json({ invite: reset, url: '/?reset=tok9' }, { status: 201 })
    return Response.json({}, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Accounts me={me} />
      <Toaster />
    </QueryClientProvider>,
  )
  return fetchMock
}

function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: `Actions for ${name}` }), { key: 'Enter' })
}

test('lists every account with whether it is in a workspace', async () => {
  mockApi()
  expect(await screen.findByText('Dan Example')).toBeInTheDocument()
  expect(screen.getByText('No workspace')).toBeInTheDocument()
  expect(screen.getByText('Server admin')).toBeInTheDocument()
})

test('disables an account', async () => {
  const fetchMock = mockApi()
  await screen.findByText('Dan Example')
  openMenu('Dan Example')
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable' }))
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/accounts/u2' && init)).toBe(
      true,
    ),
  )
  expect(await screen.findByText('Dan Example disabled')).toBeInTheDocument()
})

test('makes a reset link and shows it once', async () => {
  mockApi()
  await screen.findByText('Dan Example')
  openMenu('Dan Example')
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Reset password' }))
  expect(await screen.findByLabelText('Link')).toHaveValue(`${window.location.origin}/?reset=tok9`)
})

test('the server admin cannot disable themselves', async () => {
  mockApi()
  await screen.findByText('Dan Example')
  openMenu('Admin')
  expect(await screen.findByRole('menuitem', { name: 'Reset password' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'Disable' })).not.toBeInTheDocument()
})
