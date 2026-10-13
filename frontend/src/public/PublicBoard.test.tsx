import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Board } from '@/api/boards'
import type { Guest } from '@/board/useRefresh'
import PublicBoard from '@/public/PublicBoard'

// Whether the canvas reports its socket as live, and how it is told that the socket closed.
const socket = vi.hoisted(() => ({ live: false, closed: () => {} }))

// xyflow needs a real layout; what the page hands to the canvas is what matters here.
vi.mock('@/canvas/Canvas', () => ({
  BoardCanvas: ({
    board,
    viewer,
    guest,
    onAccessChanged,
  }: {
    board: Board
    viewer: boolean
    guest?: Guest
    onAccessChanged: () => void
  }) => {
    socket.closed = onAccessChanged
    const onLive = guest?.onLive
    useEffect(() => onLive?.(socket.live), [onLive])
    return (
      <div data-testid="canvas">
        {`${board.doc.nodes.length} nodes, v${board.version}, ${viewer ? 'viewer' : 'editor'}, ${guest?.token}`}
      </div>
    )
  },
}))

afterEach(() => {
  socket.live = false
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const sticky = (id: string) => ({
  id,
  type: 'sticky',
  position: { x: 0, y: 0 },
  data: { text: id, color: 'yellow' },
})

function board(version: number, nodes: string[]) {
  return {
    name: 'Roadmap',
    updated_at: '2026-10-10T00:00:00+00:00',
    version,
    doc: { nodes: nodes.map(sticky), edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    tasks: {},
    default_source: 'demo',
    refresh_interval_s: 30,
    room: 'a3',
  }
}

const stamp = (version: number, updated_at = '2026-10-10T00:00:00+00:00') => ({
  version,
  updated_at,
})

const gone = () =>
  Response.json({ error: { code: 'not_found', message: 'board not found' } }, { status: 404 })

function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PublicBoard token="tok123" />
    </QueryClientProvider>,
  )
}

test('a guest gets the board view-only and asks only the public routes', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/version') ? Response.json(stamp(4)) : Response.json(board(4, ['a'])),
  )
  vi.stubGlobal('fetch', fetchMock)
  show()
  expect(await screen.findByTestId('canvas')).toHaveTextContent('1 nodes, v4, viewer, tok123')
  expect(screen.getByText('Roadmap')).toBeInTheDocument()
  expect(screen.getByText('View only')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/')
  for (const [url] of fetchMock.mock.calls) expect(url).toMatch(/^\/api\/public\/tok123/)
})

test('a change on the board reaches the guest on the next check', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let version = 4
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/version')
        ? Response.json(stamp(version))
        : Response.json(board(version, version === 4 ? ['a'] : ['a', 'b'])),
    ),
  )
  show()
  expect(await screen.findByTestId('canvas')).toHaveTextContent('1 nodes, v4')
  version = 5
  await vi.advanceTimersByTimeAsync(5000)
  await waitFor(() => expect(screen.getByTestId('canvas')).toHaveTextContent('2 nodes, v5'))
})

test('a link that was turned off says so', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let off = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (off) return gone()
      return url.endsWith('/version') ? Response.json(stamp(4)) : Response.json(board(4, []))
    }),
  )
  show()
  await screen.findByTestId('canvas')
  off = true
  await vi.advanceTimersByTimeAsync(5000)
  expect(await screen.findByText('This board is not available.')).toBeInTheDocument()
  expect(screen.queryByTestId('canvas')).toBeNull()
})

test('a wrong link says the same', async () => {
  vi.stubGlobal('fetch', vi.fn(gone))
  show()
  expect(await screen.findByText('This board is not available.')).toBeInTheDocument()
})

test('a reload that fails keeps the board on screen and is tried again', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let version = 4
  let failing = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/version')) return Response.json(stamp(version))
      if (failing) return new Response('upstream down', { status: 502 })
      return Response.json(board(version, version === 4 ? ['a'] : ['a', 'b']))
    }),
  )
  show()
  expect(await screen.findByTestId('canvas')).toHaveTextContent('1 nodes, v4')
  version = 5
  failing = true
  await vi.advanceTimersByTimeAsync(5000)
  expect(screen.getByTestId('canvas')).toHaveTextContent('1 nodes, v4')
  failing = false
  await vi.advanceTimersByTimeAsync(5000)
  await waitFor(() => expect(screen.getByTestId('canvas')).toHaveTextContent('2 nodes, v5'))
})

test('a renamed board shows its new name to the guest', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let renamed = false
  const later = '2026-10-10T01:00:00+00:00'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/version')) return Response.json(stamp(4, renamed ? later : undefined))
      return Response.json(
        renamed ? { ...board(4, ['a']), name: 'Plan', updated_at: later } : board(4, ['a']),
      )
    }),
  )
  show()
  expect(await screen.findByText('Roadmap')).toBeInTheDocument()
  renamed = true
  await vi.advanceTimersByTimeAsync(5000)
  expect(await screen.findByText('Plan')).toBeInTheDocument()
})

test('a live board is checked once, and a closed socket reads it again', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  socket.live = true
  let renamed = false
  let off = false
  const fetchMock = vi.fn(async () => {
    if (off) return gone()
    return Response.json(renamed ? { ...board(4, ['a']), name: 'Plan' } : board(4, ['a']))
  })
  vi.stubGlobal('fetch', fetchMock)
  show()
  await screen.findByTestId('canvas')
  await vi.advanceTimersByTimeAsync(60_000)
  // The board, then one check for what changed while the socket was connecting.
  expect(fetchMock).toHaveBeenCalledTimes(2)

  renamed = true
  socket.closed()
  expect(await screen.findByText('Plan')).toBeInTheDocument()
  off = true
  socket.closed()
  expect(await screen.findByText('This board is not available.')).toBeInTheDocument()
})

test('a change made while the socket was connecting is read once it is live', async () => {
  socket.live = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/version')) return Response.json(stamp(4, '2026-10-10T01:00:00+00:00'))
      const first = vi.mocked(fetch).mock.calls.length === 1
      return Response.json(
        first
          ? board(4, ['a'])
          : { ...board(4, ['a']), name: 'Plan', updated_at: '2026-10-10T01:00:00+00:00' },
      )
    }),
  )
  show()
  expect(await screen.findByText('Plan')).toBeInTheDocument()
})

test('a reload after a rename that fails is tried until it works', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  socket.live = true
  const later = '2026-10-10T01:00:00+00:00'
  let renamed = false
  let failing = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/version')) return Response.json(stamp(4, renamed ? later : undefined))
      if (failing) return new Response('upstream down', { status: 502 })
      return Response.json(
        renamed ? { ...board(4, ['a']), name: 'Plan', updated_at: later } : board(4, ['a']),
      )
    }),
  )
  show()
  expect(await screen.findByText('Roadmap')).toBeInTheDocument()
  renamed = failing = true
  socket.closed()
  await vi.advanceTimersByTimeAsync(5000)
  expect(screen.getByText('Roadmap')).toBeInTheDocument()
  failing = false
  await vi.advanceTimersByTimeAsync(5000)
  expect(await screen.findByText('Plan')).toBeInTheDocument()
})
