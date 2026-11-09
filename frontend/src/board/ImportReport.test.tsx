import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import type { ImportResult } from '@/api/boards'
import type { Task } from '@/api/tasks'
import { ImportReport } from '@/board/ImportReport'

afterEach(cleanup)

const report: ImportResult = {
  board: {
    id: 'b1',
    name: 'My map',
    created_at: '2026-11-09T10:00:00Z',
    updated_at: '2026-11-09T10:00:00Z',
    my_role: 'owner',
    owner: { id: 'u1', name: 'Alex' },
    public: false,
  },
  moved: { cards: 2, stickies: 1, arrows: 3 },
  notes: [{ kind: 'picture', text: '1 picture did not move: HEIC is not supported.' }],
}

const task = (key: string, state: Task['state'], source = 'jira'): Task => ({
  source,
  key,
  state,
  summary: 'A task',
  status_name: 'To Do',
  status_category: 'new',
  type_name: 'Task',
  assignee_name: null,
  priority_name: null,
  updated: null,
  url: '',
  fetched_at: '2026-11-09T10:00:00Z',
})

test('says what moved and what still needs a hand', () => {
  const tasks = {
    'jira:A-1': task('A-1', 'not_connected'),
    'jira:A-2': task('A-2', 'not_connected'),
  }
  render(<ImportReport report={report} tasks={tasks} onClose={() => {}} />)
  expect(screen.getByText('2 cards · 1 sticky · 3 arrows')).toBeTruthy()
  expect(screen.getByText(/2 tasks from Jira show what they were at export/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Task source' })).toBeTruthy()
  expect(screen.getByText(/HEIC is not supported/)).toBeTruthy()
})

test('a tracker connected meanwhile drops out of the list', () => {
  const tasks = { 'jira:A-1': task('A-1', 'ok') }
  render(<ImportReport report={{ ...report, notes: [] }} tasks={tasks} onClose={() => {}} />)
  expect(screen.getByText('Board imported')).toBeTruthy()
  expect(screen.queryByRole('list')).toBeNull()
})
