import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { BoardSummary } from '@/api/boards'
import { Home } from './Home'
import { visibleBoards } from './list'

const ann = { id: 'u1', name: 'Ann' }
const bob = { id: 'u2', name: 'Bob' }

function board(id: string, name: string, extra: Partial<BoardSummary> = {}): BoardSummary {
  return {
    id,
    name,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-20T09:00:00Z',
    my_role: 'owner',
    owner: ann,
    public: false,
    ...extra,
  }
}

const boards = [
  board('b1', 'Roadmap Q4', { updated_at: '2026-10-21T08:00:00Z' }),
  board('b2', 'Sprint 12', { owner: bob, my_role: 'editor', updated_at: '2026-10-21T09:00:00Z' }),
  board('b3', 'Archive', { updated_at: '2026-09-01T09:00:00Z', public: true }),
]

const person = {
  id: 'u1',
  username: 'ann',
  name: 'Ann',
  role: 'member',
  server_admin: false,
  workspace: { id: 'w1', name: 'Default' },
}

function mockFetch(me: object = person) {
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/auth/status') return Response.json({ signed_in: true, me })
    if (path === '/api/boards' && init?.method === 'POST')
      return Response.json(board('new', 'Untitled board'), { status: 201 })
    if (path.endsWith('/duplicate'))
      return Response.json(board('copy', 'Copy of Roadmap Q4'), { status: 201 })
    return Response.json({ boards, all: [] })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function renderHome(others: BoardSummary[] = []) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Home boards={boards} others={others} />
    </QueryClientProvider>,
  )
}

const names = () => screen.getAllByRole('link').map((link) => link.textContent)
const address = () => new URL(window.location.href).searchParams

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

test('lists boards by last change and splits mine from shared with me', async () => {
  mockFetch()
  renderHome()
  await waitFor(() => expect(screen.getAllByText('You')).toHaveLength(2))
  expect(names()).toEqual(['Sprint 12', 'Roadmap Q4', 'Archive'])
  expect(screen.getByRole('radio', { name: /^All\s?3$/ })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /^Mine\s?2$/ })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /^Shared with me\s?1$/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: /^Mine/ }))
  expect(names()).toEqual(['Roadmap Q4', 'Archive'])
  fireEvent.click(screen.getByRole('radio', { name: /^Shared with me/ }))
  expect(names()).toEqual(['Sprint 12'])
  expect(screen.getByText('Bob')).toBeInTheDocument()
})

test('sorts by name and remembers it', async () => {
  mockFetch()
  renderHome()
  fireEvent.keyDown(screen.getByRole('button', { name: /Last change/ }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Name' }))
  expect(names()).toEqual(['Archive', 'Roadmap Q4', 'Sprint 12'])
  expect(JSON.parse(localStorage.getItem('tiko.home') ?? '{}')).toEqual({
    sort: 'name',
    layout: 'grid',
  })
})

test('the grid shows previews, a placeholder for an empty board, and the list loads none', () => {
  mockFetch()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Home
        boards={[
          board('b1', 'Roadmap', { preview: 7 }),
          board('b2', 'empty plan', { preview: null }),
        ]}
        others={[]}
      />
    </QueryClientProvider>,
  )
  const images = document.querySelectorAll('img')
  expect([...images].map((image) => image.getAttribute('src'))).toEqual([
    '/api/boards/b1/preview?v=7',
  ])
  expect(images[0]).toHaveAttribute('loading', 'lazy')
  expect(screen.getByText('E')).toBeInTheDocument()
  // A picture that fails to load gives way to the placeholder.
  fireEvent.error(images[0])
  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByText('R')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('radio', { name: 'List' }))
  expect(screen.queryByText('E')).toBeNull()
  expect(JSON.parse(localStorage.getItem('tiko.home') ?? '{}')).toEqual({
    sort: 'updated',
    layout: 'list',
  })
})

test('the list view is remembered and draws no previews', () => {
  mockFetch()
  localStorage.setItem('tiko.home', JSON.stringify({ layout: 'list' }))
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Home boards={[board('b1', 'Roadmap', { preview: 7 })]} others={[]} />
    </QueryClientProvider>,
  )
  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true')
})

test('finds a board from the keyboard: slash, typing, arrows and Enter', async () => {
  mockFetch()
  renderHome()
  fireEvent.keyDown(document, { key: '/', code: 'Slash' })
  const field = screen.getByLabelText('Find a board')
  expect(field).toHaveFocus()
  // A field just focused picks nothing yet.
  expect(document.querySelector('[data-selected="true"]')).toBeNull()
  fireEvent.keyDown(field, { key: 'ArrowDown' })
  expect(document.querySelector('[data-selected="true"]')).toHaveTextContent('Sprint 12')
  fireEvent.change(field, { target: { value: 'a' } })
  expect(names()).toEqual(['Roadmap Q4', 'Archive'])
  fireEvent.keyDown(field, { key: 'ArrowDown' })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(address().get('board')).toBe('b3')
  fireEvent.change(field, { target: { value: 'nothing like it' } })
  expect(screen.getByText('No boards match "nothing like it".')).toBeInTheDocument()
})

test('New board makes an untitled board and opens it with the name ready', async () => {
  const fetch = mockFetch()
  renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'New board' }))
  await waitFor(() => expect(address().get('board')).toBe('new'))
  expect(address().get('rename')).toBe('1')
  expect(fetch).toHaveBeenCalledWith(
    '/api/boards',
    expect.objectContaining({ body: JSON.stringify({ name: 'Untitled board' }) }),
  )
})

test('the board menu duplicates, renames and asks before deleting', async () => {
  const fetch = mockFetch()
  renderHome()
  const openMenu = async () => {
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for Roadmap Q4' }), {
      key: 'Enter',
    })
    return screen.findByRole('menu')
  }
  fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Duplicate' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/b1/duplicate',
      expect.objectContaining({ method: 'POST' }),
    ),
  )
  fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Rename' }))
  expect(await screen.findByLabelText('Board name')).toHaveValue('Roadmap Q4')
  fireEvent.keyDown(screen.getByLabelText('Board name'), { key: 'Escape' })
  fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Delete…' }))
  expect(await screen.findByText(/"Roadmap Q4" and everything on it/)).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalledWith('/api/boards/b1', expect.anything())
})

test('a board shared with me has no delete, and a demo visitor has no share', async () => {
  mockFetch({ ...person, demo_expires_at: '2026-10-28T09:00:00Z' })
  renderHome()
  await waitFor(() => expect(screen.getAllByText('You')).toHaveLength(2))
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for Sprint 12' }), {
    key: 'Enter',
  })
  const menu = await screen.findByRole('menu')
  expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
  expect(within(menu).queryByRole('menuitem', { name: 'Delete…' })).toBeNull()
  expect(within(menu).queryByRole('menuitem', { name: 'Share' })).toBeNull()
})

test("an admin sees other people's boards apart, only under All", async () => {
  mockFetch()
  renderHome([board('b9', 'Ops plan', { owner: { id: 'u9', name: 'Dana' } })])
  const section = await screen.findByRole('region', { name: 'Other boards' })
  expect(within(section).getByText('Ops plan')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: /^Mine/ }))
  expect(screen.queryByText('Ops plan')).toBeNull()
})

test('search matches every word of the name, in any case', () => {
  expect(
    visibleBoards(boards, { filter: 'all', query: 'q4 ROAD', sort: 'updated' }).map((b) => b.id),
  ).toEqual(['b1'])
})

// SC-001's second is measured in a browser; jsdom is far slower, so this only checks for paging.
test('Home lists every board at once, with no paging', { timeout: 15_000 }, async () => {
  mockFetch()
  const many = Array.from({ length: 120 }, (_, n) =>
    board(`m${n}`, `Board ${n}`, {
      updated_at: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
    }),
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Home boards={many} others={[]} />
    </QueryClientProvider>,
  )
  expect(screen.getAllByRole('link')).toHaveLength(120)
})

test('boards changed in the same second keep one order', () => {
  const same = { updated_at: '2026-10-21T09:00:00Z' }
  const tied = [
    board('b', 'Second', { ...same, created_at: '2026-10-01T09:00:00Z' }),
    board('c', 'Third', { ...same, created_at: '2026-10-01T09:00:00Z' }),
    board('a', 'First', { ...same, created_at: '2026-10-02T09:00:00Z' }),
  ]
  const order = (list: BoardSummary[]) =>
    visibleBoards(list, { filter: 'all', query: '', sort: 'updated' }).map((b) => b.id)
  expect(order(tied)).toEqual(['a', 'b', 'c'])
  expect(order(tied.toReversed())).toEqual(['a', 'b', 'c'])
})
