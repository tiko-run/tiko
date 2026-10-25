import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { SignIn } from '@/auth/SignIn'

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function show(
  demo: boolean,
  reply: () => Response = () => new Response(null, { status: 204 }),
  path = demo ? '/demo' : '',
) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply())
  vi.stubGlobal('fetch', fetchMock)
  const onSignedIn = vi.fn()
  if (path) window.history.replaceState(null, '', path)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SignIn demo={demo} onSignedIn={onSignedIn} />
    </QueryClientProvider>,
  )
  return { fetchMock, onSignedIn }
}

test('an ordinary instance opens on the sign-in form', () => {
  show(false)
  expect(screen.getByLabelText('Username')).toBeInTheDocument()
  expect(screen.queryByText('Try the demo')).toBeNull()
})

test('the sign-in form links to where the first password is', () => {
  show(false)
  expect(screen.getByRole('link', { name: 'First time here?' })).toHaveAttribute(
    'href',
    'https://docs.tiko.run/security/#the-first-password',
  )
})

test('an ordinary instance has no demo page', () => {
  show(false, undefined, '/demo')
  expect(screen.getByLabelText('Username')).toBeInTheDocument()
  expect(screen.queryByText('Try the demo')).toBeNull()
})

test('an instance with a demo opens on the sign-in form with a link to it', () => {
  show(true, undefined, '/')
  expect(screen.getByLabelText('Username')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Try the demo' })).toHaveAttribute('href', '/demo')
})

test('the demo page has one button and starts a board with it', async () => {
  const { fetchMock, onSignedIn } = show(true)
  expect(screen.queryByLabelText('Username')).toBeNull()
  expect(screen.getByText(/No account needed/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try the demo' }))
  await waitFor(() => expect(onSignedIn).toHaveBeenCalled())
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/auth/demo',
    expect.objectContaining({ method: 'POST' }),
  )
  expect(window.location.pathname).toBe('/')
})

test('the demo page links to the sign-in form', () => {
  show(true)
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/')
})

test('a full demo and a busy address say when to come back', async () => {
  const full = {
    error: { code: 'demo_full', message: 'The demo is full right now. Try again later.' },
  }
  show(true, () => Response.json(full, { status: 429 }))
  fireEvent.click(screen.getByRole('button', { name: 'Try the demo' }))
  expect(await screen.findByText(/The demo is full right now/)).toBeInTheDocument()
})

test('too many demos from one address name the wait in minutes', async () => {
  const busy = { error: { code: 'too_many_attempts', message: 'later' } }
  show(true, () => Response.json(busy, { status: 429, headers: { 'retry-after': '1500' } }))
  fireEvent.click(screen.getByRole('button', { name: 'Try the demo' }))
  expect(await screen.findByText(/Try again in 25 min/)).toBeInTheDocument()
})
