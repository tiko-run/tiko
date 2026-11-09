import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test } from 'vitest'
import { votesKey, type Round, type VotesOverview } from '@/api/votes'
import { useVoting } from './useVoting'

const round = { id: 'r1', state: 'running', left: 3 } as Round

function setup(overview: VotesOverview) {
  const client = new QueryClient()
  client.setQueryData(votesKey('b'), overview)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useVoting('b', false), { wrapper })
  return { result, read: () => client.getQueryData<VotesOverview>(votesKey('b')) }
}

test('an answer for the running round updates it', () => {
  const { result, read } = setup({ running: round, past: [] })
  act(() => result.current.put({ ...round, left: 2 }))
  expect(read()?.running?.left).toBe(2)
})

test('a round just started shows up', () => {
  const { result, read } = setup({ running: null, past: [] })
  act(() => result.current.put(round))
  expect(read()?.running?.id).toBe('r1')
})

test('a late answer does not bring back a round ended and deleted since', () => {
  const { result, read } = setup({ running: null, past: [] })
  act(() => result.current.put(round, 0))
  expect(read()?.running).toBeNull()
})
