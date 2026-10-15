import { fireEvent, render, screen } from '@testing-library/react'
import { StickyNote } from 'lucide-react'
import { act } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Task } from '@/api/tasks'
import type { AppNode } from '@/canvas/types'
import { onOnboardingDone } from '@/onboarding/done'
import { buildIndex } from './index'
import { SearchPalette } from './SearchPalette'

const at = { x: 0, y: 0 }
const sticky = (id: string, text: string): AppNode => ({
  id,
  type: 'sticky',
  position: at,
  data: { text, color: 'yellow' },
})
const card = (id: string, key: string): AppNode => ({
  id,
  type: 'task_card',
  position: at,
  data: { key },
})
const task = (key: string, summary: string, assignee: string): Task => ({
  source: 'demo',
  key,
  state: 'ok',
  summary,
  status_name: 'In Progress',
  status_category: 'indeterminate',
  type_name: 'Task',
  assignee_name: assignee,
  priority_name: null,
  updated: null,
  url: `https://jira.example.com/browse/${key}`,
  fetched_at: '2026-10-07T09:00:00Z',
})
const index = buildIndex(
  [
    card('k1', 'DEMO-1'),
    card('k2', 'DEMO-2'),
    { id: 'f', type: 'frame', position: at, data: { title: 'Sprint 12' } },
    sticky('a', 'Ping QA after deploy'),
    sticky('b', 'Deploy window on Friday'),
    sticky('c', 'Lunch'),
  ],
  {
    'DEMO-1': task('DEMO-1', 'Plan the release', 'Anna Lee'),
    'DEMO-2': task('DEMO-2', 'Fix login', 'Oleg Smirnov'),
  },
)

function setup(recent: string[] = []) {
  const onChoose = vi.fn()
  const onOpenChange = vi.fn()
  const onPreview = vi.fn()
  const onTargets = vi.fn()
  const onSelectAll = vi.fn()
  render(
    <SearchPalette
      open
      onOpenChange={onOpenChange}
      index={index}
      recent={recent}
      onChoose={onChoose}
      onPreview={onPreview}
      onTargets={onTargets}
      onSelectAll={onSelectAll}
    />,
  )
  const input = screen.getByRole('combobox', { name: 'Search the board' })
  return { input, onChoose, onOpenChange, onPreview, onTargets, onSelectAll }
}

const options = () => screen.queryAllByRole('option').map((o) => o.textContent)

test('an empty query lists recent jumps and frames', () => {
  setup(['c'])
  expect(screen.getByRole('group', { name: 'Recent' })).toHaveTextContent('Lunch')
  expect(screen.getByRole('group', { name: 'Frames' })).toHaveTextContent('Sprint 12')
})

test('typing ranks matches and highlights them', () => {
  const { input } = setup()
  fireEvent.change(input, { target: { value: 'deploy' } })
  expect(options()).toEqual(['Deploy window on Friday', 'Ping QA after deploy'])
  expect(screen.getAllByText('Deploy', { selector: 'mark' })).toHaveLength(1)
})

test('arrows wrap, Enter chooses the picked row', () => {
  const { input, onChoose } = setup()
  fireEvent.change(input, { target: { value: 'deploy' } })
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
})

test('a click chooses a row', () => {
  const { input, onChoose } = setup()
  fireEvent.change(input, { target: { value: 'lunch' } })
  fireEvent.click(screen.getByRole('option'))
  expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }))
})

test('says when nothing matches and when the layout was wrong', () => {
  const { input } = setup()
  fireEvent.change(input, { target: { value: 'zebra' } })
  expect(screen.getByText('Nothing on this board matches "zebra".')).toBeInTheDocument()
  fireEvent.change(input, { target: { value: 'дгтср' } })
  expect(screen.getByText(/Showing results for/)).toHaveTextContent('lunch')
  expect(options()).toEqual(['Lunch'])
})

test('the search shortcut closes the open palette', () => {
  const { input, onOpenChange } = setup()
  fireEvent.keyDown(input, { key: 'k', metaKey: true })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

afterEach(() => vi.useRealTimers())

test('the board previews the row picked by keyboard once the pick rests', () => {
  vi.useFakeTimers()
  const { input, onPreview } = setup()
  fireEvent.change(input, { target: { value: 'deploy' } })
  act(() => vi.advanceTimersByTime(500))
  expect(onPreview).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  act(() => vi.advanceTimersByTime(50))
  expect(onPreview).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(100))
  expect(onPreview).toHaveBeenCalledTimes(1)
  expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  fireEvent.mouseMove(screen.getAllByRole('option')[1])
  act(() => vi.advanceTimersByTime(500))
  expect(onPreview).toHaveBeenCalledTimes(1)
})

test('reports every match to light up and selects them all with mod+Enter', () => {
  const { input, onTargets, onSelectAll } = setup()
  expect(onTargets).toHaveBeenLastCalledWith([])
  fireEvent.change(input, { target: { value: 'deploy' } })
  expect(onTargets).toHaveBeenLastCalledWith(['b', 'a'])
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
  expect(onSelectAll).toHaveBeenCalledWith(['b', 'a'])
  fireEvent.click(screen.getByRole('button', { name: /Select all 2/ }))
  expect(onSelectAll).toHaveBeenCalledTimes(2)
})

test('a typed filter suggests values, Tab turns one into a chip, Backspace edits it', () => {
  const { input } = setup()
  fireEvent.change(input, { target: { value: '@an' } })
  expect(screen.getByRole('group', { name: 'Assignee' })).toHaveTextContent('Anna Lee')
  fireEvent.keyDown(input, { key: 'Tab' })
  expect(input).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Remove assignee Anna Lee' })).toBeInTheDocument()
  expect(options()).toEqual([expect.stringContaining('Plan the release')])

  fireEvent.keyDown(input, { key: 'Backspace' })
  expect(input).toHaveValue('@"Anna Lee"')
  expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
})

test('a chip is removed with its button', () => {
  const { input } = setup()
  fireEvent.change(input, { target: { value: '@ole' } })
  fireEvent.click(screen.getByRole('option'))
  expect(options()).toEqual([expect.stringContaining('Fix login')])
  fireEvent.click(screen.getByRole('button', { name: 'Remove assignee Oleg Smirnov' }))
  expect(screen.getByRole('group', { name: 'Frames' })).toBeInTheDocument()
})

test('a command runs from the palette', () => {
  const run = vi.fn()
  const onRun = vi.fn((command) => command.run())
  render(
    <SearchPalette
      open
      onOpenChange={vi.fn()}
      index={index}
      recent={[]}
      onChoose={vi.fn()}
      commands={[
        {
          id: 's',
          title: 'Add sticky note',
          group: 'Commands',
          Icon: StickyNote,
          shortcut: 'sticky',
          run,
        },
      ]}
      onRun={onRun}
    />,
  )
  const input = screen.getByRole('combobox', { name: 'Search the board' })
  fireEvent.change(input, { target: { value: 'sticky' } })
  expect(screen.getByRole('group', { name: 'Commands' })).toHaveTextContent('Add sticky noteN')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(run).toHaveBeenCalled()
})

test('Enter right after typing acts on the typed text, not a stale list', () => {
  const { input, onChoose } = setup()
  fireEvent.change(input, { target: { value: 'deploy' } })
  fireEvent.change(input, { target: { value: 'lunch' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onChoose).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c' }))
})

test('opens on commands with a prefix; mod+P narrows to commands, then closes', () => {
  const onOpenChange = vi.fn()
  render(
    <SearchPalette
      open
      onOpenChange={onOpenChange}
      index={index}
      recent={[]}
      initialText=">"
      onChoose={vi.fn()}
      commands={[{ id: 's', title: 'Settings', group: 'Commands', Icon: StickyNote, run: vi.fn() }]}
      onRun={vi.fn()}
    />,
  )
  const input = screen.getByRole<HTMLInputElement>('combobox', { name: 'Search the board' })
  expect(input).toHaveValue('>')
  expect(input).toHaveFocus()
  // The caret waits after the prefix, so typing adds to it instead of replacing it.
  expect([input.selectionStart, input.selectionEnd]).toEqual([1, 1])
  expect(options()).toEqual(['Settings'])

  fireEvent.change(input, { target: { value: 'lunch' } })
  fireEvent.keyDown(input, { key: 'p', metaKey: true })
  expect(input).toHaveValue('>lunch')
  expect(onOpenChange).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'p', metaKey: true, shiftKey: true })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test('picking a result of a filtered search ticks getting started, a plain search does not', () => {
  const seen: string[] = []
  const stop = onOnboardingDone((item) => seen.push(item))
  const { input } = setup()
  fireEvent.change(input, { target: { value: 'deploy' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(seen).toEqual([])
  fireEvent.change(input, { target: { value: '@an' } })
  fireEvent.keyDown(input, { key: 'Tab' })
  fireEvent.keyDown(input, { key: 'Enter' })
  stop()
  expect(seen).toEqual(['search_filter'])
})
