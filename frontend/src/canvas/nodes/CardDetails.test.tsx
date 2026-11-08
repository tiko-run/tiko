import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Task } from '@/api/tasks'
import { CardDetails } from '@/canvas/nodes/CardDetails'

const task: Task = {
  source: 'demo',
  key: 'DEMO-1',
  state: 'ok',
  summary: 'Show live task status on the team board',
  status_name: 'In Progress',
  status_category: 'indeterminate',
  type_name: 'Story',
  assignee_name: 'Alex Rivera',
  priority_name: 'High',
  updated: null,
  url: 'https://jira.example.com/browse/DEMO-1',
  fetched_at: '2026-11-08T09:00:00Z',
}

function rowsOf() {
  return screen.getAllByRole('term').map((term) => term.textContent)
}

test('shows the tracker dates the task has', () => {
  const next = new Date().getFullYear() + 1
  render(
    <CardDetails
      task={{ ...task, start: '2026-11-02', due: `${next}-01-15` }}
      collapsed={false}
      onToggleCollapsed={() => {}}
    />,
  )
  expect(rowsOf()).toEqual(['Assignee', 'Priority', 'Start', 'Due', 'Updated'])
  // The year shows only for a date outside this one.
  expect(screen.getByText(new RegExp(`Jan 15, ${next}$`))).toBeInTheDocument()
})

test('a task without dates gets no empty rows', () => {
  render(<CardDetails task={task} collapsed={false} onToggleCollapsed={() => {}} />)
  expect(rowsOf()).toEqual(['Assignee', 'Priority', 'Updated'])
})
