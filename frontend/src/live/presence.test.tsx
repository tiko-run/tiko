import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Faces } from '@/live/Avatar'
import {
  PRESENCE_COLORS,
  TRAVEL_BUSY_MS,
  TRAVEL_MS,
  colorOf,
  initials,
  parsePeers,
  peopleOf,
  pacer,
  presenceSender,
  selectedBy,
  throttle,
  type Peer,
} from '@/live/presence'

const user = (id: string, name: string) => ({ id, name, color: colorOf(id) })
const state = (id: string, name: string, extra: object = {}) => ({
  user: user(id, name),
  cursor: null,
  selected: [],
  drag: null,
  ...extra,
})

test('a person keeps one color, one of eight', () => {
  const ids = Array.from({ length: 200 }, (_, i) => `user-${i}`)
  for (const id of ids) {
    expect(colorOf(id)).toBe(colorOf(id))
    expect(colorOf(id)).toBeGreaterThanOrEqual(0)
    expect(colorOf(id)).toBeLessThan(PRESENCE_COLORS)
  }
  expect(new Set(ids.map(colorOf)).size).toBe(PRESENCE_COLORS)
})

test('initials', () => {
  expect(initials('Ann Lee')).toBe('AL')
  expect(initials('  ann  maria  lee ')).toBe('AL')
  expect(initials('bob')).toBe('BO')
  expect(initials('')).toBe('?')
})

test('peers: this tab is left out, a broken state is skipped, bad fields fall back', () => {
  const states = new Map<number, unknown>([
    [1, state('me', 'Me')],
    [
      2,
      state('u2', 'Bob', { cursor: { x: 1, y: 2 }, selected: ['a'], drag: { a: { x: 5, y: 6 } } }),
    ],
    [3, { user: { id: 'u3' } }],
    [4, state('u4', 'Carl', { cursor: 'nowhere', selected: 7, drag: 'x' })],
    [5, null],
  ])
  const peers = parsePeers(states, 1)
  expect(peers.map((peer) => peer.client)).toEqual([2, 4])
  expect(peers[0]).toMatchObject({ cursor: { x: 1, y: 2 }, selected: ['a'] })
  expect(peers[1]).toMatchObject({ cursor: null, selected: [], drag: null })
})

test('people: one per person across tabs, without this person', () => {
  const peers = [
    { ...state('u2', 'Bob'), client: 2 },
    { ...state('u2', 'Bob'), client: 3 },
    { ...state('me', 'Me'), client: 4 },
    { ...state('u1', 'Ann'), client: 5 },
  ] as Peer[]
  expect(peopleOf(peers, 'me').map((person) => person.name)).toEqual(['Ann', 'Bob'])
})

test('faces: five avatars, then a count with the other names', () => {
  const people = [
    'Ann Lee',
    'Bob Ray',
    'Carl Fox',
    'Dana Kim',
    'Eve Orr',
    'Finn Day',
    'Gus Poe',
  ].map((name, index) => user(`u${index}`, name))
  render(<Faces people={people} />)
  expect(screen.getByLabelText('Ann Lee').textContent).toBe('AL')
  expect(screen.getAllByTitle(/.+/).length).toBe(6)
  expect(screen.getByText('+2').title).toBe('Finn Day, Gus Poe')
  expect(screen.queryByLabelText('Finn Day')).toBeNull()
})

test('faces: nothing when nobody else is here', () => {
  const { container } = render(<Faces people={[]} />)
  expect(container.innerHTML).toBe('')
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('throttle: the first call at once, then the latest value once per interval', () => {
  const seen: number[] = []
  const send = throttle((value: number) => seen.push(value), 50)
  send(1)
  send(2)
  send(3)
  expect(seen).toEqual([1])
  vi.advanceTimersByTime(50)
  expect(seen).toEqual([1, 3])
  send(4)
  send.cancel()
  vi.advanceTimersByTime(100)
  expect(seen).toEqual([1, 3])
})

test('a move takes longer once the frames of the room come half as often', () => {
  const pace = pacer()
  let now = 0
  const frames = (gapMs: number, count: number) => {
    let ms = 0
    for (let i = 0; i < count; i++) ms = pace((now += gapMs))
    return ms
  }
  expect(frames(50, 10)).toBe(TRAVEL_MS)
  expect(frames(100, 10)).toBe(TRAVEL_BUSY_MS)
  // People who stop for a while do not make the room slow, and one late frame does not either.
  expect(frames(50, 10)).toBe(TRAVEL_MS)
  expect(frames(5000, 3)).toBe(TRAVEL_MS)
  expect(frames(120, 1)).toBe(TRAVEL_MS)
})

test('cursor and drag leave in one message, so a dragged node stays under its cursor', () => {
  const sent: object[] = []
  const mine = presenceSender((patch) => sent.push(patch))
  mine.cursor({ x: 1, y: 1 })
  mine.cursor({ x: 2, y: 2 })
  mine.drag({ a: { x: 5, y: 5 } })
  vi.advanceTimersByTime(50)
  expect(sent).toEqual([
    { cursor: { x: 1, y: 1 } },
    { cursor: { x: 2, y: 2 }, drag: { a: { x: 5, y: 5 } } },
  ])
  mine.drag(null)
  vi.advanceTimersByTime(50)
  expect(sent[2]).toEqual({ drag: null })
})

test('who has a node selected: each person once, in the order they are known', () => {
  const peers = [
    { ...state('u1', 'Ann', { selected: ['a', 'b'] }), client: 1 },
    { ...state('u1', 'Ann', { selected: ['a'] }), client: 2 },
    { ...state('u2', 'Bob', { selected: ['a'] }), client: 3 },
  ] as Peer[]
  const by = selectedBy(peers)
  expect(by.get('a')?.map((person) => person.name)).toEqual(['Ann', 'Bob'])
  expect(by.get('b')?.map((person) => person.name)).toEqual(['Ann'])
  expect(by.get('c')).toBeUndefined()
})
