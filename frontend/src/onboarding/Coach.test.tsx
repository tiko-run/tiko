import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import Coach from '@/onboarding/Coach'
import { didOnboarding } from '@/onboarding/done'

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function board() {
  document.body.innerHTML =
    '<button data-tour="tool-timer" aria-pressed="false">Timer</button>' +
    '<button data-tour="main-menu">Main menu</button>'
  return document.querySelector<HTMLElement>('[data-tour="tool-timer"]')!
}

test('points at the control, leaves it usable and moves on once it is turned on', async () => {
  const button = board()
  const clicked = vi.fn()
  button.addEventListener('click', clicked)
  render(<Coach item="set_timer" onClose={() => {}} />)
  expect(screen.getByRole('status')).toHaveTextContent('Click the timer button')
  expect(button).toHaveClass('coach-target')
  fireEvent.click(button)
  expect(clicked).toHaveBeenCalled()
  act(() => button.setAttribute('aria-pressed', 'true'))
  expect(
    await screen.findByText('Now click a card. The timer sits next to it.'),
  ).toBeInTheDocument()
  expect(button).not.toHaveClass('coach-target')
})

test('says done when the item is done, then goes', () => {
  vi.useFakeTimers()
  board()
  const onClose = vi.fn()
  render(<Coach item="set_timer" onClose={onClose} />)
  act(() => didOnboarding('set_timer'))
  expect(screen.getByRole('status')).toHaveTextContent('Done')
  act(() => vi.advanceTimersByTime(1700))
  expect(onClose).toHaveBeenCalled()
})

test('another item being done does not end it', () => {
  board()
  render(<Coach item="set_timer" onClose={() => {}} />)
  act(() => didOnboarding('focus'))
  expect(screen.getByRole('status')).toHaveTextContent('Click the timer button')
})

test('without the timer list on screen it points at the main menu', () => {
  board()
  render(<Coach item="timer_list" onClose={() => {}} />)
  expect(screen.getByRole('status')).toHaveTextContent('Open the main menu and pick Timers.')
  expect(document.querySelector('[data-tour="main-menu"]')).toHaveClass('coach-target')
})

test('the close button stops it', () => {
  board()
  const onClose = vi.fn()
  render(<Coach item="set_timer" onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: 'Stop showing' }))
  expect(onClose).toHaveBeenCalled()
})

test('a pick from a menu moves on once the menu closes', async () => {
  document.body.innerHTML = '<button data-tour="tool-module" aria-expanded="false">Modules</button>'
  const modules = document.querySelector<HTMLElement>('[data-tour="tool-module"]')!
  render(<Coach item="gantt_task" onClose={() => {}} />)
  act(() => modules.setAttribute('aria-expanded', 'true'))
  expect(await screen.findByText('Pick Gantt.')).toBeInTheDocument()
  act(() => modules.setAttribute('aria-expanded', 'false'))
  expect(await screen.findByText(/Drag a card onto the chart, or click Add/)).toBeInTheDocument()
})
