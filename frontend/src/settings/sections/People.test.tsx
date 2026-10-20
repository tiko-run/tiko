import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { People } from '@/settings/sections/People'

const me = {
  id: 'u1',
  username: 'admin',
  name: 'Admin',
  role: 'admin' as const,
  server_admin: true,
  workspace: { id: 'w1', name: 'Default' },
}
const ann = {
  id: 'u2',
  username: 'ann',
  name: 'Ann Lee',
  role: 'member',
  disabled: false,
  last_sign_in_at: null,
  created_at: '2026-10-08T10:00:00+00:00',
}
const invite = {
  id: 'i1',
  kind: 'invite',
  role: 'member',
  username: null,
  expires_at: '2026-10-15T10:00:00+00:00',
  created_at: '2026-10-08T10:00:00+00:00',
}

const seen = { disabled: false, last_sign_in_at: null, created_at: '' }

afterEach(() => vi.unstubAllGlobals())

function mockApi(revoke = () => new Response(null, { status: 204 })) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/people')
      return Response.json({
        people: [{ id: 'u1', username: 'admin', name: 'Admin', role: 'admin' }, ann].map(
          (person, i) => (i === 0 ? { ...person, ...seen } : person),
        ),
        invites: [invite],
      })
    if (url === '/api/invites' && init?.method === 'POST')
      return Response.json({ invite, url: '/?invite=tok123' }, { status: 201 })
    if (url === '/api/people/u2' && init?.method === 'PATCH')
      return Response.json({ ...ann, ...JSON.parse(String(init.body)) })
    if (url === '/api/invites/i1') return revoke()
    return Response.json({}, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <People me={me} />
      <Toaster />
    </QueryClientProvider>,
  )
  return fetchMock
}

const methods = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)

test('lists people and open links', async () => {
  mockApi()
  expect(await screen.findByText('Ann Lee')).toBeInTheDocument()
  expect(screen.getByText(/\(you\)/)).toBeInTheDocument()
  expect(screen.getByText(/ann · Never signed in/)).toBeInTheDocument()
  expect(screen.getByText('Invite as member')).toBeInTheDocument()
})

test('shows a new invite link once, with the full address', async () => {
  const fetchMock = mockApi()
  await screen.findByText('Ann Lee')
  fireEvent.keyDown(screen.getByRole('button', { name: 'Invite' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'As member' }))
  const field = await screen.findByLabelText('Link')
  expect(field).toHaveValue(`${window.location.origin}/?invite=tok123`)
  expect(methods(fetchMock)).toContain('POST /api/invites')
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByLabelText('Link')).not.toBeInTheDocument()
})

test('makes a person an admin from the row menu, with nothing about their account', async () => {
  const fetchMock = mockApi()
  await screen.findByText('Ann Lee')
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for Ann Lee' }), { key: 'Enter' })
  expect(screen.queryByRole('menuitem', { name: 'Disable' })).not.toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'Reset password' })).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Make admin' }))
  await waitFor(() => expect(methods(fetchMock)).toContain('PATCH /api/people/u2'))
  const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/people/u2' && init?.method)
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ role: 'admin' })
  expect(await screen.findByText('Ann Lee is now an admin')).toBeInTheDocument()
})

test('revokes an open link', async () => {
  const fetchMock = mockApi()
  const row = (await screen.findByText('Invite as member')).closest('li')!
  fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
  await waitFor(() => expect(methods(fetchMock)).toContain('DELETE /api/invites/i1'))
})

test('says in a toast why a link was not revoked', async () => {
  mockApi(() =>
    Response.json(
      { error: { code: 'conflict', message: 'This link is already used.' } },
      { status: 409 },
    ),
  )
  const row = (await screen.findByText('Invite as member')).closest('li')!
  fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
  expect(await screen.findByText('This link is already used.')).toBeInTheDocument()
})
