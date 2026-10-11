import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { TimerData } from '@/canvas/types'
import { TimerEditor } from './TimerEditor'

const data: TimerData = { note: 'Ping QA', dueAt: '2099-01-01T10:00:00.000Z' }

test('a timer on a task card can wait for its status instead of the clock', () => {
  const onChange = vi.fn()
  render(
    <TimerEditor
      data={data}
      holder="DEMO-1"
      task={{ key: 'DEMO-1', status: 'In Review' }}
      onChange={onChange}
      onDelete={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'When the status changes' }))
  expect(onChange).toHaveBeenCalledWith({
    note: 'Ping QA',
    dueAt: null,
    watch: { key: 'DEMO-1', status: 'In Review' },
  })
})

test('a clock timer picks how it repeats', () => {
  const onChange = vi.fn()
  render(<TimerEditor data={data} onChange={onChange} onDelete={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'When the status changes' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Weekdays' }))
  expect(onChange).toHaveBeenCalledWith({ ...data, repeat: 'weekdays' })
})

test('a status timer says what it waits for', () => {
  render(
    <TimerEditor
      data={{ note: '', dueAt: null, watch: { key: 'DEMO-1', status: 'In Review' } }}
      onChange={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('Goes off when DEMO-1 leaves In Review.')
  expect(screen.queryByRole('group', { name: 'Repeat' })).toBeNull()
})
