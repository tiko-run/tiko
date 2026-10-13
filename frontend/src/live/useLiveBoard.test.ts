import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { Board } from '@/api/boards'
import { AUTH_REQUIRED_EVENT } from '@/api/client'
import type { AppNode } from '@/canvas/types'
import { useLiveBoard } from '@/live/useLiveBoard'

type Handler = (...args: never[]) => void

/** The provider as the hook sees it: events in, `connect` calls out; no socket. */
const { providers, FakeProvider } = vi.hoisted(() => {
  const providers: InstanceType<typeof FakeProvider>[] = []
  class FakeProvider {
    wsconnected = true
    connect = vi.fn()
    destroy = vi.fn()
    awareness: unknown
    doc: Y.Doc
    url: string
    room: string
    private handlers = new Map<string, Handler[]>()

    constructor(url: string, room: string, doc: Y.Doc) {
      this.url = url
      this.room = room
      this.doc = doc
      providers.push(this)
    }

    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...(args as never[]))
    }

    drop() {
      this.wsconnected = false
      this.emit('status', { status: 'disconnected' })
    }

    back() {
      this.wsconnected = true
      this.emit('sync', true)
    }
  }
  return { providers, FakeProvider }
})

vi.mock('y-websocket', async () => {
  const { Awareness } = await import('y-protocols/awareness')
  return {
    WebsocketProvider: class extends FakeProvider {
      constructor(url: string, room: string, doc: Y.Doc) {
        super(url, room, doc)
        this.awareness = new Awareness(doc)
      }
    },
  }
})

const board: Board = {
  id: 'b1',
  name: 'Q4',
  updated_at: '2026-10-05T00:00:00+00:00',
  my_role: 'owner',
  owner: { id: 'u1', name: 'Admin' },
  public: false,
  version: 3,
  doc: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  tasks: {},
  default_source: 'demo',
}
const me = { id: 'u1', name: 'Admin' }
const sticky = (id: string): AppNode =>
  ({ id, type: 'sticky', position: { x: 0, y: 0 }, data: { text: id, color: 'yellow' } }) as AppNode

function open(onAccessChanged = vi.fn()) {
  const hook = renderHook(() => useLiveBoard(board, false, onAccessChanged, me))
  const provider = providers[providers.length - 1]
  return { ...hook, provider, onAccessChanged }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => setTimeout(() => run(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ signed_in: false, me: null }))),
  )
  providers.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('the board cannot be edited before the first sync, and says so when it never comes', () => {
  const { result, provider } = open()
  expect(result.current.status).toBe('connecting')
  expect(result.current.editable).toBe(false)
  act(() => vi.advanceTimersByTime(5000))
  expect(result.current.status).toBe('unavailable')
  act(() => provider.emit('sync', true))
  expect(result.current.status).toBe('live')
  expect(result.current.editable).toBe(true)
})

test('a dropped connection: editing goes on, a warning comes only with unsent changes', () => {
  const { result, provider } = open()
  act(() => provider.emit('sync', true))
  act(() => provider.drop())
  expect(result.current.status).toBe('reconnecting')
  expect(result.current.editable).toBe(true)
  act(() => vi.advanceTimersByTime(30_000))
  expect(result.current.status).toBe('reconnecting')

  act(() => result.current.setNodes([sticky('offline')]))
  act(() => provider.drop())
  act(() => vi.advanceTimersByTime(30_000))
  expect(result.current.status).toBe('unsaved')
  const leaving = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(leaving)
  expect(leaving.defaultPrevented).toBe(true)

  act(() => provider.back())
  expect(result.current.status).toBe('live')
  const later = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(later)
  expect(later.defaultPrevented).toBe(false)
  // The change made offline is in the document that was just exchanged with the server.
  expect(provider.doc.getMap('nodes').has('offline')).toBe(true)
})

test('an ended session sends the tab to sign-in', () => {
  const { provider } = open()
  const signedOut = vi.fn()
  window.addEventListener(AUTH_REQUIRED_EVENT, signedOut)
  act(() => provider.emit('closed', { code: 4401, reason: '' }))
  expect(signedOut).toHaveBeenCalledOnce()
  expect(provider.connect).not.toHaveBeenCalled()
  window.removeEventListener(AUTH_REQUIRED_EVENT, signedOut)
})

test('changed access: the role is read again and the same role connects again', () => {
  const { provider, onAccessChanged } = open()
  act(() => provider.emit('sync', true))
  act(() => provider.emit('closed', { code: 4403, reason: '' }))
  expect(onAccessChanged).toHaveBeenCalledOnce()
  expect(provider.connect).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1000))
  expect(provider.connect).toHaveBeenCalledOnce()
})

test('a full board is view-only and tries again every 30 seconds', () => {
  const { result, provider } = open()
  act(() => provider.emit('closed', { code: 4429, reason: '' }))
  expect(result.current.status).toBe('full')
  expect(result.current.editable).toBe(false)
  act(() => vi.advanceTimersByTime(30_000))
  expect(provider.connect).toHaveBeenCalledOnce()
  act(() => provider.emit('sync', true))
  expect(result.current.status).toBe('live')
})

test('a refused connection asks whether the person is still signed in', async () => {
  const { provider } = open()
  const signedOut = vi.fn()
  window.addEventListener(AUTH_REQUIRED_EVENT, signedOut)
  act(() => provider.emit('connection-error', new Event('error')))
  act(() => provider.emit('connection-error', new Event('error')))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(fetch).toHaveBeenCalledOnce()
  expect(signedOut).toHaveBeenCalledOnce()
  window.removeEventListener(AUTH_REQUIRED_EVENT, signedOut)
})

test('leaving the board ends its connection and its timers', () => {
  const { provider, unmount } = open()
  act(() => provider.emit('closed', { code: 4429, reason: '' }))
  unmount()
  act(() => vi.advanceTimersByTime(60_000))
  expect(provider.destroy).toHaveBeenCalledOnce()
  expect(provider.connect).not.toHaveBeenCalled()
})

test('a guest of a public link listens on the socket of the link and says nothing', () => {
  const onAccessChanged = vi.fn()
  const { result, rerender } = renderHook(
    ({ shown }: { shown: Board }) =>
      useLiveBoard(shown, true, onAccessChanged, undefined, 'tok/live/a3'),
    { initialProps: { shown: board } },
  )
  const [provider] = providers
  expect(provider.url).toMatch(/\/api\/public$/)
  expect(provider.room).toBe('tok/live/a3')
  expect((provider.awareness as Awareness).getLocalState()).toBeNull()
  const reloaded = (ids: string[]) => ({ ...board, doc: { ...board.doc, nodes: ids.map(sticky) } })
  const shown = () => result.current.nodes.map((node) => node.id)

  // Until the socket is live the board is the one the page loads.
  rerender({ shown: reloaded(['a']) })
  expect(shown()).toEqual(['a'])
  act(() => provider.emit('sync', true))
  expect(result.current.status).toBe('live')
  expect(shown()).toEqual([])
  rerender({ shown: reloaded(['a', 'b']) })
  expect(shown()).toEqual([])

  // A full board: the page's reloads are shown again.
  act(() => provider.emit('closed', { code: 4429, reason: '' }))
  rerender({ shown: reloaded(['c']) })
  expect(shown()).toEqual(['c'])
  act(() => provider.emit('sync', true))
  expect(shown()).toEqual([])

  // A socket that dropped and may never come back: reloads are shown too.
  act(() => provider.drop())
  expect(result.current.status).toBe('reconnecting')
  rerender({ shown: reloaded(['d']) })
  expect(shown()).toEqual(['d'])
  act(() => provider.back())
  expect(shown()).toEqual([])

  // A dead link or a rename: the page reads the board again, nobody is sent to sign in.
  const signIn = vi.fn()
  window.addEventListener(AUTH_REQUIRED_EVENT, signIn)
  act(() => provider.emit('closed', { code: 4403, reason: '' }))
  act(() => provider.emit('connection-error'))
  expect(onAccessChanged).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
  expect(signIn).not.toHaveBeenCalled()
  window.removeEventListener(AUTH_REQUIRED_EVENT, signIn)
})
