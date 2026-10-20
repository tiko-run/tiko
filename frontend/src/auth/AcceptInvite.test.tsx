import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Me } from '@/api/auth'
import { AcceptInvite, readInviteLink } from '@/auth/AcceptInvite'

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

type Auth = ComponentProps<typeof AcceptInvite>['auth']
const signedOut: Auth = { isPending: false, data: { signed_in: false, me: null } }
const ann: Me = {
  id: 'u2',
  username: 'ann',
  name: 'Ann Lee',
  role: null,
  server_admin: false,
  workspace: null,
}

function show(kind: 'invite' | 'reset', reply: Response, auth: Auth = signedOut) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    url.endsWith('/accept') || url.endsWith('/join')
      ? new Response(null, { status: 204 })
      : reply.clone(),
  )
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AcceptInvite link={{ kind, token: 'tok' }} auth={auth} />
    </QueryClientProvider>,
  )
  return fetchMock
}

const anInvite = () => Response.json({ kind: 'invite', role: 'admin', username: null })

test('reads the link from the address', () => {
  window.history.replaceState(null, '', '/?reset=abc')
  expect(readInviteLink()).toEqual({ kind: 'reset', token: 'abc' })
  window.history.replaceState(null, '', '/?board=x')
  expect(readInviteLink()).toBeNull()
})

test('joins with a username, a name and a password', async () => {
  const fetchMock = show(
    'invite',
    Response.json({ kind: 'invite', role: 'member', username: null }),
  )
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Ann Lee' } })
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ann ' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-enough-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Join tiko' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  const [url, init] = fetchMock.mock.calls[1]
  expect(url).toBe('/api/invites/tok/accept')
  expect(JSON.parse(String(init?.body))).toEqual({
    username: 'ann',
    name: 'Ann Lee',
    password: 'long-enough-password',
  })
})

test('asks only for a new password on a reset link', async () => {
  show('reset', Response.json({ kind: 'reset', role: null, username: 'ann' }))
  expect(await screen.findByText('Set a new password for ann.')).toBeInTheDocument()
  expect(screen.getByLabelText('New password')).toBeInTheDocument()
  expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
})

test('says when a link has expired', async () => {
  const message = 'This invite link has expired. Ask your admin for a new one.'
  show('invite', Response.json({ error: { code: 'invite_expired', message } }, { status: 410 }))
  expect(await screen.findByText(message)).toBeInTheDocument()
})

test('a signed-in person outside a workspace joins with their account', async () => {
  const fetchMock = show('invite', anInvite(), {
    isPending: false,
    data: { signed_in: true, me: ann },
  })
  expect(
    await screen.findByText('You are invited to a workspace as an admin. Join as Ann Lee?'),
  ).toBeInTheDocument()
  expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Join' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(fetchMock.mock.calls[1][0]).toBe('/api/invites/tok/join')
})

test('someone in a workspace is told so', async () => {
  const me = { ...ann, role: 'member' as const, workspace: { id: 'w1', name: 'Default' } }
  show('invite', anInvite(), { isPending: false, data: { signed_in: true, me } })
  expect(await screen.findByText('You are already in a workspace.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument()
})

test('signs in from the invite instead of making a new account', async () => {
  show('invite', anInvite())
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Sign in/ })).toBeDisabled()
})
