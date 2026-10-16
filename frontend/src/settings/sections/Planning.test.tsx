import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Me } from '@/api/auth'
import { Planning } from '@/settings/sections/Planning'

afterEach(() => vi.unstubAllGlobals())

const types = [
  { id: 't1', name: 'Discovery', hue: 75, archived: false },
  { id: 't2', name: 'Build', hue: 250, archived: false },
]

function show(role: 'admin' | 'member', enabled: boolean) {
  let state = { enabled, types: enabled ? types : [] }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (url === '/api/planning' && init?.method === 'PATCH') {
      state = { enabled: body.enabled, types: body.enabled ? types : [] }
    }
    if (url === '/api/planning/types') return Response.json({ id: 't9', archived: false, ...body })
    if (url.startsWith('/api/planning/types/'))
      return Response.json({ ...types.find((t) => url.endsWith(t.id)), ...body })
    return Response.json(state)
  })
  vi.stubGlobal('fetch', fetchMock)
  const me = { role } as Me
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Planning me={me} />
    </QueryClientProvider>,
  )
  return fetchMock
}

test('an admin turns Planning on and sees the stage types', async () => {
  show('admin', false)
  const toggle = await screen.findByRole('switch', { name: 'Cut Gantt rows into stages' })
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  expect(await screen.findByLabelText('Name of Discovery')).toBeInTheDocument()
})

test('a member sees the switch read-only and can still add a type', async () => {
  const fetchMock = show('member', true)
  expect(
    await screen.findByText('Only an admin can switch Planning on or off.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'Cut Gantt rows into stages' })).toBeDisabled()
  fireEvent.change(await screen.findByLabelText('New stage type'), {
    target: { value: 'Testing' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(await screen.findByLabelText('Name of Testing')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/planning/types',
    expect.objectContaining({ method: 'POST', body: '{"name":"Testing","hue":25}' }),
  )
})

test('an archived type moves to the archived list', async () => {
  show('member', true)
  fireEvent.click(await screen.findByRole('button', { name: 'Archive Build' }))
  expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Name of Build')).toBeNull()
})
