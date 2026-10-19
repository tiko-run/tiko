import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { BoardRole } from '@/api/boards'
import { ShareDialog } from '@/board/ShareDialog'

const user = (id: string, name: string) => ({ id, username: name.toLowerCase(), name })
const members = {
  members: [
    { user: user('u1', 'Ann'), role: 'owner' },
    { user: user('u2', 'Bob'), role: 'editor' },
  ],
  everyone_role: null,
  public: false,
  public_token: null,
}
const settings = {
  provider: 'demo',
  refresh_interval_s: 30,
  secret_key_configured: false,
  jira: { base_url: null, token_state: 'none' },
  public_links: true,
  locked: [],
}

afterEach(() => vi.unstubAllGlobals())

function show(myRole: BoardRole, link: string | null = null, allowed = true, demo = false) {
  let token = link
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/boards/b1/members')
      return Response.json({
        ...members,
        public: token !== null,
        public_token: myRole === 'owner' ? token : null,
      })
    if (url === '/api/auth/status') return Response.json({ signed_in: true, me: null, demo })
    if (url === '/api/settings') return Response.json({ ...settings, public_links: allowed })
    if (url === '/api/boards/b1/public') {
      token = JSON.parse(String(init?.body)).public ? 'tok123' : null
      return Response.json({ public: token !== null, public_token: token })
    }
    if (url.startsWith('/api/people/directory'))
      return Response.json({ people: [user('u2', 'Bob'), user('u3', 'Carl')] })
    if (init?.method === 'PUT' && url.includes('/members/'))
      return Response.json({ user: user('u3', 'Carl'), role: 'editor' })
    return new Response(null, { status: 204 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const board = {
    id: 'b1',
    name: 'Sprint',
    updated_at: '',
    my_role: myRole,
    owner: { id: 'u1', name: 'Ann' },
    public: link !== null,
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ShareDialog board={board} open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
  return fetchMock
}

const calls = (fetchMock: ReturnType<typeof show>) =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)

test('the owner adds a person who is not on the board yet', async () => {
  const fetchMock = show('owner')
  fireEvent.change(await screen.findByLabelText('Add people'), { target: { value: 'c' } })
  const list = await screen.findByRole('list', { name: 'Matching people' })
  expect(list).toHaveTextContent('Carl')
  expect(list).not.toHaveTextContent('Bob')
  fireEvent.click(screen.getByRole('button', { name: /Carl/ }))
  await waitFor(() => expect(calls(fetchMock)).toContain('PUT /api/boards/b1/members/u3'))
})

test('the owner lets everyone view the board', async () => {
  const fetchMock = show('owner')
  fireEvent.keyDown(await screen.findByRole('button', { name: /No access/ }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Can view' }))
  await waitFor(() => expect(calls(fetchMock)).toContain('PUT /api/boards/b1/everyone'))
})

test('others see who has access but cannot change it', async () => {
  show('editor')
  expect(await screen.findByText('Bob')).toBeInTheDocument()
  expect(screen.getByText('Only the owner can change who has access.')).toBeInTheDocument()
  expect(screen.queryByLabelText('Add people')).toBeNull()
  expect(screen.queryByRole('button', { name: /Can edit/ })).toBeNull()
})

test('the owner turns the public link on and gets the address', async () => {
  const fetchMock = show('owner')
  fireEvent.click(await screen.findByRole('switch', { name: 'Public link' }))
  await waitFor(() => expect(calls(fetchMock)).toContain('PUT /api/boards/b1/public'))
  const address = await screen.findByLabelText('Public link address')
  expect(address).toHaveValue(`${window.location.origin}/p/tok123`)
})

test('an editor sees that the board is public, without the link', async () => {
  show('editor', 'tok123')
  const section = await screen.findByRole('region', { name: 'Public link' })
  expect(section).toHaveTextContent('On')
  expect(screen.queryByRole('switch', { name: 'Public link' })).toBeNull()
  expect(screen.queryByLabelText('Public link address')).toBeNull()
})

test('public links switched off by an admin cannot be turned on', async () => {
  show('owner', null, false)
  expect(await screen.findByText(/An admin switched public links off/)).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'Public link' })).toBeDisabled()
})

test('where anyone can sign up there is no "everyone" and a person is found by username', async () => {
  show('owner', null, true, true)
  expect(await screen.findByPlaceholderText('Add a person by their username')).toBeInTheDocument()
  expect(screen.queryByText('Everyone with an account')).toBeNull()
})
