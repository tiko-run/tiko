import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Input } from '@/components/ui/input'

function show(disabled = false, onKeyDown?: (event: React.KeyboardEvent) => void) {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  render(
    <form onSubmit={onSubmit}>
      <Input aria-label="Name" onKeyDown={onKeyDown} />
      <button type="submit" disabled={disabled}>
        Save
      </button>
    </form>,
  )
  return onSubmit
}

test('Enter submits the form even where the browser does not', () => {
  const onSubmit = show()
  fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })
  expect(onSubmit).toHaveBeenCalledTimes(1)
})

test('a disabled Save keeps Enter idle, as in the browser', () => {
  const onSubmit = show(true)
  fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })
  expect(onSubmit).not.toHaveBeenCalled()
})

test("a field's own Enter wins", () => {
  const onSubmit = show(false, (event) => event.preventDefault())
  fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })
  expect(onSubmit).not.toHaveBeenCalled()
})
