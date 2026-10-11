import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Task } from '@/api/tasks'
import type { AppNode, TimerData } from '@/canvas/types'
import { useTimers } from './useTimers'

const NOW = Date.parse('2026-10-07T08:00:00.000Z')
const shown: { title: string; body?: string }[] = []

class FakeNotification {
  static permission = 'granted'
  onclick: (() => void) | null = null
  constructor(title: string, options?: NotificationOptions) {
    shown.push({ title, body: options?.body })
  }
  close() {}
}

function timer(id: string, dueAt: string, parentId?: string): AppNode {
  return {
    id,
    type: 'timer',
    position: { x: 0, y: 0 },
    ...(parentId && { parentId }),
    data: { note: `note ${id}`, dueAt },
  }
}

const quiet = { tasks: {}, onOpen: () => {}, onChange: () => {} }

const card: AppNode = {
  id: 'a',
  type: 'task_card',
  position: { x: 0, y: 0 },
  data: { key: 'DEMO-1' },
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  vi.stubGlobal('Notification', FakeNotification)
  localStorage.clear()
  shown.length = 0
  document.title = 'tiko'
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('a timer that goes off while the board is open notifies once and counts in the title', () => {
  const nodes = [card, timer('t', '2026-10-07T08:00:02.000Z', 'a')]
  const { result, rerender } = renderHook(({ list }) => useTimers(list, quiet), {
    initialProps: { list: nodes },
  })
  expect(result.current.fired).toEqual([])

  act(() => vi.advanceTimersByTime(3000))
  expect(result.current.fired).toMatchObject([{ id: 't', holder: 'DEMO-1' }])
  expect(shown).toHaveLength(1)
  expect(shown[0].title).toBe('note t')
  expect(shown[0].body).toMatch(/^On DEMO-1 · Set for /)
  expect(document.title).toBe('(1) tiko')

  rerender({ list: [...nodes] })
  act(() => vi.advanceTimersByTime(3000))
  expect(shown).toHaveLength(1)
})

test('timers that went off while the board was closed are counted quietly', () => {
  const nodes = [timer('t', '2026-10-07T07:00:00.000Z'), timer('u', '2026-10-07T07:30:00.000Z')]
  const { result, unmount } = renderHook(() => useTimers(nodes, quiet))
  expect(result.current.missed).toBe(2)
  expect(shown).toHaveLength(0)
  unmount()
  expect(document.title).toBe('tiko')

  // Seen once, they are not reported again after a reload.
  const again = renderHook(() => useTimers(nodes, quiet))
  expect(again.result.current.missed).toBe(0)
})

test('a status timer goes off when the refresh shows a new status', () => {
  const watching: AppNode = {
    id: 'w',
    type: 'timer',
    position: { x: 0, y: 0 },
    parentId: 'a',
    data: { note: '', dueAt: null, watch: { key: 'DEMO-1', status: 'In Review' } },
  }
  const onChange = vi.fn()
  const task = (status_name: string) => ({
    'DEMO-1': { key: 'DEMO-1', state: 'ok', status_name } as Task,
  })
  const { rerender } = renderHook(
    ({ tasks }) => useTimers([card, watching], { ...quiet, tasks, onChange }),
    { initialProps: { tasks: task('In Review') } },
  )
  expect(onChange).not.toHaveBeenCalled()

  rerender({ tasks: task('Done') })
  expect(onChange).toHaveBeenCalledTimes(1)
  const [id, change] = onChange.mock.calls[0]
  expect(id).toBe('w')
  expect(change(watching.data as TimerData)).toMatchObject({
    dueAt: new Date(NOW).toISOString(),
    watch: { changedTo: 'Done' },
  })
})
