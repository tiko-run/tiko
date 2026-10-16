import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Me } from '@/api/auth'
import { Planning } from '@/settings/sections/Planning'

afterEach(() => vi.unstubAllGlobals())

const types = [
  { id: 't1', name: 'Discovery', hue: 75, archived: false },
  { id: 't2', name: 'Build', hue: 250, archived: false },
]

const people = [
  { id: 'p1', name: 'Oleg', teams: ['Web'], source: 'tracker', archived: false, off: [] },
]

const fields = [
  { id: 'priority', name: 'Priority', standard: true, archived: false },
  { id: 'f7', name: 'Quarter', standard: false, archived: false },
]

function show(role: 'admin' | 'member', enabled: boolean) {
  let state = {
    enabled,
    types: enabled ? types : [],
    people: enabled ? people : [],
    fields: enabled ? fields : [],
  }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (url === '/api/planning' && init?.method === 'PATCH') {
      state = {
        enabled: body.enabled,
        types: body.enabled ? types : [],
        people: body.enabled ? people : [],
        fields: body.enabled ? fields : [],
      }
    }
    if (url === '/api/planning/types') return Response.json({ id: 't9', archived: false, ...body })
    if (url === '/api/planning/people')
      return Response.json({
        id: 'p9',
        teams: [],
        source: 'manual',
        archived: false,
        off: [],
        ...body,
      })
    if (url.startsWith('/api/planning/people/'))
      return Response.json({ ...state.people.find((p) => url.endsWith(p.id)), ...body })
    if (url === '/api/planning/fields')
      return Response.json({ id: 'f9', standard: false, archived: false, ...body })
    if (url.startsWith('/api/planning/fields/'))
      return Response.json({ ...fields.find((f) => url.endsWith(f.id)), ...body })
    if (url.startsWith('/api/planning/types/'))
      return Response.json({ ...types.find((t) => url.endsWith(t.id)), ...body })
    return Response.json(state)
  })
  vi.stubGlobal('fetch', fetchMock)
  const me = { role } as Me
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <Planning me={me} />
    </QueryClientProvider>,
  )
  return Object.assign(fetchMock, { queryClient })
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
  const field = await screen.findByLabelText('New stage type')
  fireEvent.change(field, { target: { value: 'Testing' } })
  fireEvent.submit(field)
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

test('a person is added by hand with teams, and archived', async () => {
  const fetchMock = show('member', true)
  expect(await screen.findByText('Tracker assignee')).toBeInTheDocument()
  expect(screen.getByLabelText('Teams of Oleg')).toHaveValue('Web')
  fireEvent.change(screen.getByLabelText('New person'), { target: { value: 'Petra' } })
  const teams = screen.getByLabelText('Teams of the new person')
  fireEvent.change(teams, { target: { value: 'Web, Core, web' } })
  fireEvent.submit(teams)
  expect(await screen.findByLabelText('Name of Petra')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/planning/people',
    expect.objectContaining({
      method: 'POST',
      body: '{"name":"Petra","teams":["Web","Core","web"]}',
    }),
  )
  expect(screen.getByText('Added by hand')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Archive Oleg' }))
  expect(await screen.findByRole('button', { name: 'Restore Oleg' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Name of Oleg')).toBeNull()
})

test('a rename by someone else shows in a field nobody is typing in', async () => {
  const fetchMock = show('member', true)
  const { queryClient } = fetchMock
  expect(await screen.findByLabelText('Name of Oleg')).toHaveValue('Oleg')
  act(() =>
    queryClient.setQueryData(['planning'], (was: { people: object[] }) => ({
      ...was,
      people: [{ ...people[0], name: 'Oleg K' }],
    })),
  )
  const field = await screen.findByLabelText('Name of Oleg K')
  expect(field).toHaveValue('Oleg K')
  fireEvent.focus(field)
  fireEvent.blur(field)
  // Leaving it untouched sends nothing, so the other person's rename stays.
  const writes = fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith('/api/planning/people/'),
  )
  expect(writes).toEqual([])
})

test("time off is added and removed in the person's card", async () => {
  const listed = show('member', true)
  const off = { id: 'o1', start: '2026-10-05', end: '2026-10-09' }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/planning/people/p1/off') return Response.json({ ...people[0], off: [off] })
    if (url === '/api/planning/people/p1/off/o1') return Response.json(people[0])
    return listed(url, init)
  })
  vi.stubGlobal('fetch', fetchMock)
  fireEvent.click(await screen.findByRole('button', { name: 'Add time off for Oleg' }))
  fireEvent.change(screen.getByLabelText('Oleg is away from'), {
    target: { value: '2026-10-05' },
  })
  const until = screen.getByLabelText('Oleg is away until')
  fireEvent.change(until, { target: { value: '2026-10-09' } })
  fireEvent.submit(until)
  const remove = await screen.findByRole('button', {
    name: 'Remove time off Mon Oct 5 – Fri Oct 9 of Oleg',
  })
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/planning/people/p1/off',
    expect.objectContaining({ method: 'POST', body: '{"start":"2026-10-05","end":"2026-10-09"}' }),
  )
  fireEvent.click(remove)
  await waitFor(() => expect(screen.queryByRole('button', { name: /Remove time off/ })).toBeNull())
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/planning/people/p1/off/o1',
    expect.objectContaining({ method: 'DELETE' }),
  )
})

test('time off cannot end before it starts', async () => {
  show('member', true)
  fireEvent.click(await screen.findByRole('button', { name: 'Add time off for Oleg' }))
  fireEvent.change(screen.getByLabelText('Oleg is away from'), {
    target: { value: '2026-10-09' },
  })
  const until = screen.getByLabelText('Oleg is away until')
  fireEvent.change(until, { target: { value: '2026-10-05' } })
  expect(within(until.closest('form')!).getByRole('button', { name: 'Add' })).toBeDisabled()
})

test('a field is added and archived; a standard one stays', async () => {
  const fetchMock = show('member', true)
  const field = await screen.findByLabelText('New field')
  fireEvent.change(field, { target: { value: 'Budget code' } })
  fireEvent.submit(field)
  expect(await screen.findByLabelText('Name of field Budget code')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/planning/fields',
    expect.objectContaining({ method: 'POST', body: '{"name":"Budget code"}' }),
  )
  expect(screen.queryByRole('button', { name: 'Archive field Priority' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Archive field Quarter' }))
  expect(await screen.findByRole('button', { name: 'Restore field Quarter' })).toBeInTheDocument()
})
