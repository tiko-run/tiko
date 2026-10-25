import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { groupTimers } from './groups'
import { setTimerPanelOpen } from './panel'
import { TimerButton, TimerPanel } from './TimerList'
import type { TimerEntry } from './useTimers'

// Wednesday, 7 Oct 2026, 11:00 local time.
const NOW = new Date(2026, 9, 7, 11, 0).getTime()
const MIN = 60_000

const timers: TimerEntry[] = [
  { id: 'a', note: 'Deploy window', state: 'fired', at: NOW - 5 * MIN },
  { id: 'b', note: 'Ping QA', state: 'running', at: NOW + 28 * MIN, holder: 'DEMO-1' },
  { id: 'c', note: '', state: 'running', at: NOW + 2 * 86_400_000 },
  { id: 'd', note: 'Review', state: 'watching', at: null, holder: 'DEMO-2' },
  { id: 'e', note: 'Old', state: 'done', at: NOW - 60 * MIN },
]

afterEach(() => setTimerPanelOpen(false))

test('groups timers by what the user should look at first', () => {
  const groups = groupTimers(timers, NOW).map((g) => [g.title, g.timers.map((t) => t.id)])
  expect(groups).toEqual([
    ['Gone off', ['a']],
    ['Today', ['b']],
    ['Later', ['c']],
    ['Waiting for status', ['d']],
    ['Done', ['e']],
  ])
})

test('the button counts running timers and names the next one', () => {
  render(<TimerButton timers={timers} now={NOW} />)
  const button = screen.getByRole('button', { name: 'Reminders: 3 running, 1 gone off' })
  expect(button).toHaveAttribute('title', 'Next: Ping QA · in 28m')
  fireEvent.click(button)
  expect(button).toHaveAttribute('aria-pressed', 'true')
})

test('the panel stays open on a jump and closes with Esc', () => {
  const onOpen = vi.fn()
  const onDone = vi.fn()
  setTimerPanelOpen(true)
  render(
    <TimerPanel timers={timers} now={NOW} onOpen={onOpen} onDone={onDone} onSnooze={vi.fn()} />,
  )
  fireEvent.click(screen.getByText('Ping QA'))
  expect(onOpen).toHaveBeenCalledWith('b')
  expect(screen.getByText('in 28m · 11:28 · on DEMO-1')).toBeInTheDocument()
  expect(screen.getByText('in 2d · Fri, 09.10.2026, 11:00')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(onDone).toHaveBeenCalledWith('a')
  expect(screen.getByRole('dialog', { name: 'Reminders' })).toBeInTheDocument()

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Reminders' })).toBeNull()
})
