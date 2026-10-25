import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { NewPassword, rememberSignIn } from '@/auth/NewPassword'

afterEach(() => vi.unstubAllGlobals())

function show(reply: () => Response = () => new Response(null, { status: 204 })) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply())
  vi.stubGlobal('fetch', fetchMock)
  const onDone = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewPassword username="admin" onDone={onDone} />
    </QueryClientProvider>,
  )
  return { fetchMock, onDone }
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

test('right after signing in it asks only for the new password, twice', async () => {
  rememberSignIn('from-the-log')
  const { fetchMock, onDone } = show()
  expect(screen.queryByLabelText('Current password')).toBeNull()
  type('New password', 'my-own-password')
  type('Repeat the new password', 'my-own-passwor')
  expect(screen.getByText('The passwords do not match.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled()
  type('Repeat the new password', 'my-own-password')
  fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/me/password')
  expect(JSON.parse(String(init?.body))).toEqual({
    current: 'from-the-log',
    new: 'my-own-password',
  })
})

test('after a reload it asks for the current password too', async () => {
  const error = { error: { code: 'invalid_credentials', message: 'wrong' } }
  show(() => new Response(JSON.stringify(error), { status: 401 }))
  type('Current password', 'not-it')
  type('New password', 'my-own-password')
  type('Repeat the new password', 'my-own-password')
  fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
  expect(await screen.findByText('The current password is wrong.')).toBeInTheDocument()
})

test('signing out is the only other way off the screen', async () => {
  const { fetchMock, onDone } = show()
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/logout')
})
