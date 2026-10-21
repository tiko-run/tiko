import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { BoardSummary } from '@/api/boards'
import { Home } from './Home'
import { inPlace, visibleBoards } from './list'
import { timeLeft } from '@/lib/time'

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
  board('b1', 'Roadmap Q4', { updated_at: '2026-10-21T08:00:00Z', folder_id: 'f1' }),
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

const team = { id: 'f1', name: 'Team', position: 1 }

const DAY = 24 * 3600 * 1000
const trashed = [
  {
    id: 't1',
    name: 'Old plan',
    owner: ann,
    deleted_at: new Date(Date.now() - DAY).toISOString(),
    deleted_by: ann,
    purge_at: new Date(Date.now() + 29 * DAY + 3600_000).toISOString(),
  },
  {
    id: 't2',
    name: 'Bob notes',
    owner: bob,
    deleted_at: new Date(Date.now() - 2 * DAY).toISOString(),
    deleted_by: bob,
    purge_at: new Date(Date.now() + 28 * DAY + 3600_000).toISOString(),
  },
]

function mockFetch(me: object = person, folders = [team], trash = trashed.slice(0, 1)) {
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/auth/status') return Response.json({ signed_in: true, me })
    if (path === '/api/trash') return Response.json({ boards: trash })
    if (path.endsWith('/restore') || path.includes('forever=1'))
      return new Response(null, { status: 204 })
    if (path === '/api/folders' && init?.method === 'POST')
      return Response.json({ id: 'f2', name: 'Archive', position: 2 }, { status: 201 })
    if (path === '/api/folders') return Response.json({ folders })
    if (/\/(star|folder)$|^\/api\/folders\//.test(path)) return new Response(null, { status: 204 })
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

test('the board menu duplicates, renames and asks before moving to the trash', async () => {
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
  fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Move to trash…' }))
  expect(await screen.findByText(/"Roadmap Q4" waits in the trash/)).toBeInTheDocument()
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
  expect(within(menu).queryByRole('menuitem', { name: 'Move to trash…' })).toBeNull()
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

test('starred boards come first in either sort', () => {
  const starred = boards.map((b) => (b.id === 'b3' ? { ...b, starred: true } : b))
  const order = (sort: 'updated' | 'name') =>
    visibleBoards(starred, { filter: 'all', query: '', sort }).map((b) => b.id)
  expect(order('updated')).toEqual(['b3', 'b2', 'b1'])
  expect(order('name')).toEqual(['b3', 'b1', 'b2'])
  expect(starred.filter((b) => inPlace(b, 'starred')).map((b) => b.id)).toEqual(['b3'])
  expect(boards.filter((b) => inPlace(b, { folder: 'f1' })).map((b) => b.id)).toEqual(['b1'])
})

test('the side shows starred boards and a folder with its boards', async () => {
  mockFetch()
  renderHome()
  const places = screen.getByRole('navigation', { name: 'Places' })
  fireEvent.click(await within(places).findByRole('button', { name: /^Team/ }))
  expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
  expect(names()).toEqual(['Roadmap Q4'])
  fireEvent.click(within(places).getByRole('button', { name: /^Starred/ }))
  expect(screen.getByText('Star a board to keep it here.')).toBeInTheDocument()
  fireEvent.click(within(places).getByRole('button', { name: /^All boards/ }))
  expect(names()).toEqual(['Sprint 12', 'Roadmap Q4', 'Archive'])
})

test('a star and the folder menu send the change', async () => {
  const fetch = mockFetch()
  renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'Star Sprint 12' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/b2/star',
      expect.objectContaining({ method: 'PUT' }),
    ),
  )
  await screen.findByRole('button', { name: /^Team/ })
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for Archive' }), { key: 'Enter' })
  const menu = await screen.findByRole('menu')
  fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Move to folder' }), {
    key: 'ArrowRight',
  })
  const folders = (await screen.findAllByRole('menu')).at(-1)!
  fireEvent.click(within(folders).getByRole('menuitem', { name: 'Team' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/b3/folder',
      expect.objectContaining({ body: JSON.stringify({ folder_id: 'f1' }) }),
    ),
  )
})

test('without folders the move menu says so', async () => {
  mockFetch(person, [])
  renderHome()
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for Archive' }), { key: 'Enter' })
  const menu = await screen.findByRole('menu')
  fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Move to folder' }), {
    key: 'ArrowRight',
  })
  const sub = (await screen.findAllByRole('menu')).at(-1)!
  expect(within(sub).getByRole('menuitem', { name: 'No folders yet' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('a new folder is named in place, and a board dragged onto it moves there', async () => {
  const fetch = mockFetch()
  renderHome()
  fireEvent.click(screen.getAllByRole('button', { name: 'New folder' })[0])
  const field = screen.getByLabelText('New folder name')
  fireEvent.change(field, { target: { value: ' Archive ' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/folders',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Archive' }) }),
    ),
  )
  expect(fetch.mock.calls.filter(([path]) => path === '/api/folders').length).toBeGreaterThan(0)

  const data = new Map<string, string>()
  const dataTransfer = {
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  }
  const row = screen.getByRole('link', { name: 'Sprint 12' }).closest('li')!
  fireEvent.dragStart(row, { dataTransfer })
  const target = (await screen.findByRole('button', { name: /^Team/ })).parentElement!
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/b2/folder',
      expect.objectContaining({ body: JSON.stringify({ folder_id: 'f1' }) }),
    ),
  )
})

test('deleting a folder asks nothing and keeps its boards', async () => {
  const fetch = mockFetch()
  renderHome()
  fireEvent.keyDown(await screen.findByRole('button', { name: 'Actions for Team' }), {
    key: 'Enter',
  })
  fireEvent.click(
    within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Delete folder' }),
  )
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/folders/f1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
  expect(fetch).not.toHaveBeenCalledWith('/api/boards/b1', expect.anything())
})

test('the trash lists deleted boards with the time left, restores and deletes for good', async () => {
  const fetch = mockFetch(person, [team], trashed)
  renderHome()
  const side = await screen.findByRole('navigation', { name: 'Places' })
  await waitFor(() => expect(within(side).getByRole('button', { name: /Trash\s?2/ })).toBeTruthy())
  fireEvent.click(within(side).getByRole('button', { name: /Trash/ }))
  expect(await screen.findByRole('heading', { name: 'Trash' })).toBeInTheDocument()
  const list = screen.getByRole('list', { name: 'Boards in the trash' })
  expect(within(list).getAllByText('29 days left').length).toBeGreaterThan(0)
  expect(within(list).getByText(/Deleted yesterday$/)).toBeInTheDocument()
  expect(within(list).getByText(/by Bob/)).toBeInTheDocument()
  // Only the owner deletes for good; anyone who sees the board here restores it.
  expect(screen.queryByRole('button', { name: 'Delete Bob notes for good' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'New board' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Restore Bob notes' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/t2/restore',
      expect.objectContaining({ method: 'POST' }),
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Delete Old plan for good' }))
  expect(await screen.findByText(/This cannot be undone/)).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalledWith('/api/boards/t1?forever=1', expect.anything())
  fireEvent.click(screen.getByRole('button', { name: 'Delete for good' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/t1?forever=1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
})

test('an empty trash says so', async () => {
  mockFetch(person, [team], [])
  renderHome()
  fireEvent.click(await screen.findByRole('button', { name: /^Trash/ }))
  expect(await screen.findByText('The trash is empty.')).toBeInTheDocument()
})

test('the time left counts whole days and the last one reads Goes today', () => {
  const now = Date.parse('2026-10-21T12:00:00Z')
  expect(timeLeft('2026-11-20T12:00:00Z', now)).toBe('30 days left')
  expect(timeLeft('2026-10-23T11:00:00Z', now)).toBe('1 day left')
  expect(timeLeft('2026-10-22T11:00:00Z', now)).toBe('Goes today')
  expect(timeLeft('2026-10-21T11:00:00Z', now)).toBe('Goes today')
})
