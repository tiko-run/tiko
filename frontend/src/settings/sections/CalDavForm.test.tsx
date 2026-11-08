import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CalDavForm } from '@/settings/sections/CalDavForm'

afterEach(() => vi.unstubAllGlobals())

const LISTS = [
  { id: 'https://cloud.example.com/dav/personal/', name: 'Personal', color: '0082c9', shown: true },
  { id: 'https://cloud.example.com/dav/work/', name: 'Work', color: '', shown: true },
]

function show(state: 'none' | 'set') {
  let account =
    state === 'set'
      ? { state, address: 'https://cloud.example.com/', username: 'ann' }
      : { state, address: null, username: null }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/me/caldav' && init?.method === 'PUT') {
      account = { state: 'set', address: 'https://cloud.example.com/', username: 'ann' }
      return Response.json({ ...account, display_name: 'Ann Example', lists: LISTS })
    }
    if (url === '/api/me/caldav/lists' && init?.method === 'PUT') {
      const hidden: string[] = JSON.parse(String(init.body)).hidden
      return Response.json({ lists: LISTS.map((l) => ({ ...l, shown: !hidden.includes(l.id) })) })
    }
    if (url === '/api/me/caldav/lists') return Response.json({ lists: LISTS })
    return Response.json(account)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CalDavForm />
    </QueryClientProvider>,
  )
  return fetchMock
}

test('connects an account and then shows its lists', async () => {
  const fetchMock = show('none')
  fireEvent.change(await screen.findByLabelText('Server address'), {
    target: { value: ' cloud.example.com ' },
  })
  fireEvent.change(screen.getByLabelText('User name'), { target: { value: 'ann' } })
  fireEvent.change(screen.getByLabelText('App password'), { target: { value: 'app-pass' } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect(await screen.findByLabelText('Personal')).toBeChecked()
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({
    address: 'cloud.example.com',
    username: 'ann',
    password: 'app-pass',
  })
})

test('a stored account keeps its password when it is left blank', async () => {
  show('set')
  expect(await screen.findByText(/Leave it blank to keep it/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Remove account' })).toBeVisible()
})

test('switching a list off sends it as hidden', async () => {
  const fetchMock = show('set')
  const list = await screen.findByRole('list')
  fireEvent.click(within(list).getByLabelText('Work'))
  expect(await screen.findByLabelText('Work')).not.toBeChecked()
  const put = fetchMock.mock.calls.find(
    ([url, init]) => url === '/api/me/caldav/lists' && init?.method === 'PUT',
  )
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({
    hidden: ['https://cloud.example.com/dav/work/'],
  })
})
