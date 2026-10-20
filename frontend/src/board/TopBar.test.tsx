import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { BoardSummary } from '@/api/boards'
import { TopBar } from '@/board/TopBar'

const owner = { id: 'u1', name: 'Admin' }
const base = { updated_at: '2026-10-05T07:00:00Z', my_role: 'owner', owner, public: false } as const
const boards = [
  { id: 'a', name: 'Q4 goals', ...base },
  { id: 'b', name: 'Team Platform', ...base },
] satisfies BoardSummary[]

afterEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

function renderBar(onSelect = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TopBar boards={boards} current={boards[0]} onSelect={onSelect} />
    </QueryClientProvider>,
  )
  return onSelect
}

test('switches boards from the board menu', async () => {
  const onSelect = renderBar()
  fireEvent.keyDown(screen.getByRole('button', { name: /Q4 goals/ }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Team Platform' }))
  expect(onSelect).toHaveBeenCalledWith('b')
})

test('switches to the dark theme from the main menu', async () => {
  renderBar()
  fireEvent.keyDown(screen.getByRole('button', { name: 'Main menu' }), { key: 'Enter' })
  fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Theme' }), { key: 'ArrowRight' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(localStorage.getItem('tiko.theme')).toBe('dark')
})

test('opens the shortcut list with ?', async () => {
  renderBar()
  fireEvent.keyDown(document, { key: '?', code: 'Slash', shiftKey: true })
  const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
  expect(dialog).toHaveTextContent('Duplicate')
})

test('renames the current board inline', async () => {
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ ...boards[0], name: 'Q1 goals' }), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetch)
  renderBar()
  fireEvent.keyDown(screen.getByRole('button', { name: /Q4 goals/ }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename board' }))
  const field = await screen.findByLabelText('Board name')
  fireEvent.change(field, { target: { value: 'Q1 goals' } })
  fireEvent.submit(field)
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/a',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Q1 goals' }) }),
    ),
  )
  vi.unstubAllGlobals()
})

test('deletes a board only after confirming', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  renderBar()
  fireEvent.keyDown(screen.getByRole('button', { name: /Q4 goals/ }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete board…' }))
  expect(await screen.findByText(/"Q4 goals" and everything on it/)).toBeTruthy()
  expect(fetch).not.toHaveBeenCalledWith('/api/boards/a', expect.anything())
  fireEvent.click(screen.getByRole('button', { name: 'Delete board' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/a',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
  vi.unstubAllGlobals()
})

test('shows who is signed in and opens settings with mod+comma', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        signed_in: true,
        me: {
          id: 'u1',
          username: 'ann',
          name: 'Ann Lee',
          role: 'member',
          server_admin: false,
          workspace: { id: 'w1', name: 'Default' },
        },
      }),
    ),
  )
  renderBar()
  fireEvent.keyDown(screen.getByRole('button', { name: 'Main menu' }), { key: 'Enter' })
  expect(await screen.findByText('Ann Lee')).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  fireEvent.keyDown(document.body, { key: 'Escape' })
  fireEvent.keyDown(document, { key: ',', code: 'Comma', metaKey: true, ctrlKey: true })
  await waitFor(() =>
    expect(new URL(window.location.href).searchParams.get('settings')).toBe('profile'),
  )
  vi.unstubAllGlobals()
})

test('a demo visitor sees the demo mark, no Share, and is asked before signing out', async () => {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
    url === '/api/auth/status'
      ? Response.json({
          signed_in: true,
          demo: true,
          me: {
            id: 'u9',
            username: '~0a1b2c3d4e5f',
            name: 'Demo visitor',
            role: 'member',
            server_admin: false,
            workspace: { id: 'w1', name: 'Default' },
            demo_expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          },
        })
      : new Response(null, { status: 204 }),
  )
  vi.stubGlobal('fetch', fetch)
  renderBar()
  expect(await screen.findByText('Demo · 7 days')).toBeInTheDocument()
  const asked = fetch.mock.calls.length
  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(asked))
  expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Sign up to keep it' }))
  expect(
    await screen.findByRole('dialog', { name: 'Sign up to keep your boards' }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.keyDown(screen.getByRole('button', { name: 'Main menu' }), { key: 'Enter' })
  expect(await screen.findByText('Demo visitor')).toBeInTheDocument()
  expect(screen.queryByText('~0a1b2c3d4e5f')).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
  expect(await screen.findByRole('dialog', { name: 'Leave the demo?' })).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalledWith('/api/auth/logout', expect.anything())
  vi.unstubAllGlobals()
})

test('a viewer sees View only and cannot rename or delete', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TopBar
        boards={[{ ...boards[0], my_role: 'viewer' }]}
        others={[]}
        current={{ ...boards[0], my_role: 'viewer' }}
        onSelect={vi.fn()}
      />
    </QueryClientProvider>,
  )
  expect(screen.getByText('View only')).toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('button', { name: /Q4 goals/ }), { key: 'Enter' })
  await screen.findByRole('menuitem', { name: 'New board' })
  expect(screen.queryByRole('menuitem', { name: 'Rename board' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: /Delete board/ })).toBeNull()
})

test('admins find boards shared with no one under All boards', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TopBar
        boards={[boards[0]]}
        others={[{ ...boards[1], owner: { id: 'u9', name: 'Dana' } }]}
        current={boards[0]}
        onSelect={vi.fn()}
      />
    </QueryClientProvider>,
  )
  fireEvent.keyDown(screen.getByRole('button', { name: /Q4 goals/ }), { key: 'Enter' })
  expect(await screen.findByText('All boards')).toBeInTheDocument()
  expect(screen.getByRole('menuitemradio', { name: /Team Platform/ })).toBeInTheDocument()
})
