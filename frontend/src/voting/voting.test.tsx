import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { Round } from '@/api/votes'
import type { AppNode } from '@/canvas/types'
import { VoteControl } from '@/voting/VoteControl'
import { voteElements, VotingContext } from '@/voting/useVoting'

const round = (over: Partial<Round> = {}): Round => ({
  id: 'r',
  name: 'Vote 1',
  votes: 3,
  stack: true,
  anonymous: true,
  elements: ['a', 'b'],
  started_by: { id: 'p', name: 'Ann' },
  started_at: '2026-11-09T10:00:00+00:00',
  ends_at: null,
  ended_at: null,
  state: 'running',
  joined: true,
  done: false,
  mine: {},
  left: 3,
  joined_count: 1,
  done_count: 0,
  can_manage: true,
  still_voting: [],
  results: null,
  voted_count: null,
  ...over,
})

function control(id: string, value: Round, active = true) {
  const vote = vi.fn()
  render(
    <VotingContext.Provider value={{ round: value, active, vote }}>
      <VoteControl id={id} />
    </VotingContext.Provider>,
  )
  return vote
}

test('a voter adds and takes back votes on an element of the round', () => {
  const vote = control('a', round({ mine: { a: 2 }, left: 1 }))
  expect(screen.getByLabelText('Your votes').textContent).toBe('2')
  fireEvent.click(screen.getByRole('button', { name: 'Vote' }))
  fireEvent.click(screen.getByRole('button', { name: 'Take back a vote' }))
  expect(vote.mock.calls).toEqual([
    ['a', 1],
    ['a', -1],
  ])
})

test('no votes left, or one per element, stops the plus', () => {
  control('a', round({ mine: { b: 3 }, left: 0 }))
  expect(screen.getByRole('button', { name: 'Vote' })).toHaveProperty('disabled', true)
})

test('one vote per element holds', () => {
  control('a', round({ stack: false, mine: { a: 1 }, left: 2 }))
  expect(screen.getByRole('button', { name: 'Vote' })).toHaveProperty('disabled', true)
})

test('nothing shows outside the round or before joining', () => {
  control('z', round())
  control('a', round(), false)
  expect(screen.queryByRole('button', { name: 'Vote' })).toBeNull()
})

test('a vote takes the selected notes and cards and those in selected frames', () => {
  const node = (id: string, type: string, extra: Partial<AppNode> = {}) =>
    ({ id, type, position: { x: 0, y: 0 }, data: {}, ...extra }) as AppNode
  const nodes = [
    node('f', 'frame', { selected: true }),
    node('in', 'sticky', { parentId: 'f' }),
    node('card', 'task_card', { selected: true }),
    node('shape', 'shape', { selected: true }),
    node('away', 'sticky'),
  ]
  expect(voteElements(nodes)).toEqual(['in', 'card'])
})
