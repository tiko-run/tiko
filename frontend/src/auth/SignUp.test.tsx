import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { SignUpDialog } from '@/auth/SignUp'

afterEach(() => vi.unstubAllGlobals())

const member = {
  id: 'u9',
  username: 'ann',
  name: 'Ann Lee',
  role: 'member',
  server_admin: false,
  workspace: { id: 'w1', name: 'Default' },
  demo_expires_at: null,
}

function show(reply: () => Response) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply())
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient()
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <SignUpDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ann Lee ' } })
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' ann' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-enough-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
  return { fetchMock, client, onOpenChange }
}

test('signs up and drops the demo mark without a reload', async () => {
  const { fetchMock, client, onOpenChange } = show(() => Response.json(member))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/auth/signup')
  expect(JSON.parse(String(init?.body))).toEqual({
    name: 'Ann Lee',
    username: 'ann',
    password: 'long-enough-password',
  })
  expect(client.getQueryData(['auth'])).toEqual({ signed_in: true, me: member, demo: true })
})

test('a taken username stays on the form', async () => {
  const taken = { error: { code: 'username_taken', message: 'This username is taken.' } }
  const { onOpenChange } = show(() => Response.json(taken, { status: 409 }))
  expect(await screen.findByText('This username is taken.')).toBeInTheDocument()
  expect(onOpenChange).not.toHaveBeenCalled()
})
