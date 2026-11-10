import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { ApiKeys } from '@/settings/sections/ApiKeys'

const DAY_MS = 24 * 3600 * 1000
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS - 60_000).toISOString()

const agentKey = {
  id: 'k1',
  name: 'My agent',
  scope: 'read',
  boards: null,
  prefix: 'Ab3x',
  created_at: '2026-11-01T10:00:00+00:00',
  expires_at: inDays(30),
  last_used_on: '2026-11-08',
}
const oldKey = {
  ...agentKey,
  id: 'k2',
  name: 'Old script',
  boards: ['b1', 'b2'],
  prefix: 'Zz90',
  expires_at: inDays(-1),
  last_used_on: null,
}
const board = (id: string, name: string) => ({
  id,
  name,
  created_at: '',
  updated_at: '',
  my_role: 'owner',
  owner: null,
  public: false,
})

afterEach(() => vi.unstubAllGlobals())

function mockApi({
  enabled = true,
  create = () => Response.json({ key: { ...agentKey, id: 'k3' }, token: 'tiko_secret' }),
}: { enabled?: boolean; create?: () => Response } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/me/api-keys' && init?.method === 'POST') return create()
    if (url === '/api/me/api-keys') return Response.json({ keys: [agentKey, oldKey], enabled })
    if (url === '/api/me/api-keys/k1' && init?.method === 'DELETE')
      return new Response(null, { status: 204 })
    if (url === '/api/boards')
      return Response.json({ boards: [board('b1', 'Roadmap'), board('b2', 'Sprint')], all: [] })
    return Response.json({}, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiKeys />
      <Toaster />
    </QueryClientProvider>,
  )
  return fetchMock
}

const methods = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)

async function fillDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'New key' }))
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: ' Claude ' } })
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'secret-pw' } })
}

test('lists keys with their reach, expiry and last use', async () => {
  mockApi()
  const row = (await screen.findByText('My agent')).closest('li')!
  expect(row).toHaveTextContent('tiko_Ab3x…')
  expect(row).toHaveTextContent('All boards')
  expect(row).toHaveTextContent('Expires in 30 days')
  expect(row).toHaveTextContent('Last used 08.11.2026')
  expect(row).toHaveTextContent('Read')
  const old = screen.getByText('Old script').closest('li')!
  expect(old).toHaveTextContent('2 boards')
  expect(old).toHaveTextContent('Expired')
  expect(old).toHaveTextContent('Never used')
})

test('creates a read key for chosen boards and shows its token once', async () => {
  const fetchMock = mockApi()
  await fillDialog()
  expect(screen.getByLabelText('Read')).toBeChecked()
  expect(screen.queryByLabelText('Read and write')).not.toBeInTheDocument()
  expect(screen.getByLabelText('90 days')).toBeChecked()
  fireEvent.click(screen.getByLabelText('Chosen boards'))
  const create = screen.getByRole('button', { name: 'Create key' })
  // Chosen boards with none ticked is not a key yet.
  expect(create).toBeDisabled()
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Sprint' }))
  fireEvent.click(screen.getByLabelText('30 days'))
  fireEvent.click(create)
  const field = await screen.findByLabelText('Key')
  expect(field).toHaveValue('tiko_secret')
  expect(screen.getByText('Copy this key now. It is not shown again.')).toBeInTheDocument()
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({
    name: 'Claude',
    scope: 'read',
    boards: ['b2'],
    days: 30,
    password: 'secret-pw',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByLabelText('Key')).not.toBeInTheDocument()
  expect(screen.queryByText(/tiko_secret/)).not.toBeInTheDocument()
})

test('sends all boards as null', async () => {
  const fetchMock = mockApi()
  await fillDialog()
  fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
  await screen.findByLabelText('Key')
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ boards: null, days: 90 })
})

test('names a wrong password by the field, not in a toast', async () => {
  mockApi({
    create: () =>
      Response.json(
        { error: { code: 'invalid_credentials', message: 'The current password is wrong.' } },
        { status: 401 },
      ),
  })
  await fillDialog()
  fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByText('The current password is wrong.')).toBeInTheDocument()
  expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.queryByLabelText('Key')).not.toBeInTheDocument()
})

test('says too many attempts in a toast', async () => {
  mockApi({
    create: () =>
      Response.json(
        { error: { code: 'too_many_attempts', message: 'Too many attempts. Try in a minute.' } },
        { status: 429 },
      ),
  })
  await fillDialog()
  fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
  expect(await screen.findByText('Too many attempts. Try in a minute.')).toBeInTheDocument()
  expect(within(screen.getByRole('dialog')).queryByText(/Too many/)).not.toBeInTheDocument()
})

test('offers no new key when the admin switched keys off, and still lists them', async () => {
  mockApi({ enabled: false })
  expect(await screen.findByText('Your admin has switched API keys off.')).toBeInTheDocument()
  expect(screen.getByText('My agent')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'New key' })).not.toBeInTheDocument()
})

test('revokes a key after asking', async () => {
  const fetchMock = mockApi()
  const row = (await screen.findByText('My agent')).closest('li')!
  fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent('Revoke My agent?')
  expect(methods(fetchMock)).not.toContain('DELETE /api/me/api-keys/k1')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))
  await waitFor(() => expect(methods(fetchMock)).toContain('DELETE /api/me/api-keys/k1'))
  expect(await screen.findByText('My agent revoked')).toBeInTheDocument()
})
