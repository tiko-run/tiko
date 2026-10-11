import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { beforeAll, expect, test } from 'vitest'
import type { Task } from '@/api/tasks'
import { TasksContext } from '@/canvas/tasks-context'
import { TaskCardNode } from '@/canvas/nodes/TaskCardNode'
import { BoardSourcesContext } from '@/sources/board-sources'
import type { TaskCardNode as TaskCardNodeType } from '@/canvas/types'

const task: Task = {
  source: 'jira',
  key: 'DEMO-1',
  state: 'ok',
  summary: 'Rotate the staging certificates',
  status_name: 'In Progress',
  status_category: 'indeterminate',
  type_name: 'Task',
  assignee_name: 'Alex Doe',
  priority_name: 'High',
  updated: '2026-10-04T12:00:00Z',
  url: 'https://jira.example.com/browse/DEMO-1',
  fetched_at: '2026-10-05T07:00:00Z',
}

const nodeTypes = { task_card: TaskCardNode }

beforeAll(() => {
  // xyflow measures nodes; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

function renderCard(data: TaskCardNodeType['data'], tasks: Record<string, Task>, mixed = false) {
  const node: TaskCardNodeType = { id: 'n1', type: 'task_card', position: { x: 0, y: 0 }, data }
  render(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlowProvider>
        <TasksContext.Provider value={tasks}>
          <BoardSourcesContext.Provider value={{ mixed, defaultSource: 'jira' }}>
            <ReactFlow nodes={[node]} nodeTypes={nodeTypes} />
          </BoardSourcesContext.Provider>
        </TasksContext.Provider>
      </ReactFlowProvider>
    </div>,
  )
}

test('expanded card shows the title and links the key to Jira', () => {
  renderCard({ key: 'DEMO-1' }, { 'DEMO-1': task })
  expect(screen.getByText('Rotate the staging certificates')).toBeTruthy()
  expect(screen.getByText('DEMO-1').closest('a')?.getAttribute('href')).toBe(task.url)
})

test('collapsed card shows the key and status only', () => {
  renderCard({ key: 'DEMO-1', collapsed: true }, { 'DEMO-1': task })
  expect(screen.getByText('DEMO-1')).toBeTruthy()
  expect(screen.getByText('In Progress')).toBeTruthy()
  expect(screen.queryByText('Rotate the staging certificates')).toBeNull()
})

test('a closed task has its key struck through', () => {
  const done = { ...task, status_name: 'Done', status_category: 'done' as const }
  renderCard({ key: 'DEMO-1', collapsed: true }, { 'DEMO-1': done })
  expect(screen.getByText('DEMO-1').className).toContain('line-through')
})

test('a missing task says so and opens no mini-card', () => {
  const missing = { ...task, state: 'not_found' as const }
  renderCard({ key: 'DEMO-1' }, { 'DEMO-1': missing })
  const label = screen.getByText('Not found or no access')
  fireEvent.pointerDown(label)
  fireEvent.click(label)
  expect(screen.queryByText('Open in Jira')).toBeNull()
})

test('a click opens the mini-card with assignee, priority and a Jira link', () => {
  renderCard({ key: 'DEMO-1', collapsed: true }, { 'DEMO-1': task })
  const key = screen.getByText('DEMO-1')
  fireEvent.pointerDown(key, { clientX: 10, clientY: 10 })
  fireEvent.click(key, { clientX: 10, clientY: 10 })
  expect(screen.getByText('Alex Doe')).toBeTruthy()
  expect(screen.getByText('High')).toBeTruthy()
  expect(screen.getByRole('link', { name: /Open in Jira/ }).getAttribute('target')).toBe('_blank')
  expect(screen.getByRole('button', { name: /Expand card/ })).toBeTruthy()
})

test('a drag does not open the mini-card', () => {
  renderCard({ key: 'DEMO-1', collapsed: true }, { 'DEMO-1': task })
  const key = screen.getByText('DEMO-1')
  fireEvent.pointerDown(key, { clientX: 10, clientY: 10 })
  fireEvent.click(key, { clientX: 60, clientY: 10 })
  expect(screen.queryByText('Open in Jira')).toBeNull()
})

test('a card without a token of your own shows only the key and how to connect', () => {
  const locked: Task = { ...task, key: 'DEV-2', state: 'no_token', summary: '', type_name: '' }
  renderCard({ key: 'DEV-2' }, { 'DEV-2': locked })
  // xyflow keeps unmeasured nodes out of the accessibility tree, so find it by text.
  fireEvent.click(screen.getByText('Connect your Jira token to see this task'))
  expect(new URL(window.location.href).searchParams.get('settings')).toBe('tracker')
})

test('a guest of a public board sees the key and its link, nothing else', () => {
  const hidden: Task = {
    ...task,
    state: 'private',
    summary: '',
    status_name: '',
    type_name: '',
    assignee_name: null,
    priority_name: null,
  }
  renderCard({ key: 'DEMO-1', collapsed: true }, { 'DEMO-1': hidden })
  const key = screen.getByText('DEMO-1')
  expect(key.closest('a')?.getAttribute('href')).toBe(task.url)
  expect(key.closest('.react-flow__node')?.textContent).toBe('DEMO-1')
  fireEvent.pointerDown(key)
  fireEvent.click(key)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('a card names the tracker its task comes from', () => {
  const demo: Task = { ...task, source: 'demo' }
  renderCard({ key: 'DEMO-1', source: 'demo', collapsed: true }, { 'demo:DEMO-1': demo })
  const key = screen.getByText('DEMO-1')
  fireEvent.pointerDown(key, { clientX: 10, clientY: 10 })
  fireEvent.click(key, { clientX: 10, clientY: 10 })
  expect(screen.getByRole('link', { name: /Open in the demo tracker/ })).toBeTruthy()
})

test('a card starts with the mark of its tracker only on a board that mixes trackers', () => {
  renderCard({ key: 'DEMO-1' }, { 'DEMO-1': task })
  expect(document.querySelector('img[alt="Jira"]')).toBeNull()
  cleanup()
  renderCard({ key: 'DEMO-1' }, { 'DEMO-1': task }, true)
  const mark = document.querySelector('img[alt="Jira"]')
  expect(mark).toBeTruthy()
  // The mark comes first, before the type icon and the key.
  expect(mark?.parentElement?.firstElementChild).toBe(mark)
})

test('a GitHub card shows the short key, its kind and the full key in the mini-card', () => {
  const issue: Task = {
    ...task,
    source: 'github',
    key: 'octo-org/widgets#12',
    type_name: 'Pull request',
    status_name: 'Draft',
    priority_name: null,
    url: 'https://github.com/octo-org/widgets/pull/12',
  }
  renderCard(
    { key: 'octo-org/widgets#12', source: 'github', collapsed: true },
    { 'github:octo-org/widgets#12': issue },
  )
  const key = screen.getByText('widgets#12')
  expect(screen.getByLabelText('Pull request')).toBeTruthy()
  fireEvent.pointerDown(key, { clientX: 10, clientY: 10 })
  fireEvent.click(key, { clientX: 10, clientY: 10 })
  expect(screen.getByText('octo-org/widgets#12')).toBeTruthy()
  expect(screen.getByRole('link', { name: /Open in GitHub/ })).toBeTruthy()
})

test('the mini-card of a GitHub task shows labels as chips and the author', () => {
  const issue: Task = {
    ...task,
    source: 'github',
    key: 'octo-org/widgets#12',
    priority_name: null,
    labels: [
      { name: 'bug', color: 'd73a4a' },
      { name: 'good first issue', color: 'fef2c0' },
      { name: 'plain', color: '' },
      { name: 'blue', color: '0088ff' },
      { name: 'violet', color: '5319e7' },
    ],
    rows: [{ label: 'Author', value: 'sam-lee' }],
  }
  renderCard(
    { key: 'octo-org/widgets#12', source: 'github', collapsed: true },
    { 'github:octo-org/widgets#12': issue },
  )
  const key = screen.getByText('widgets#12')
  fireEvent.pointerDown(key, { clientX: 10, clientY: 10 })
  fireEvent.click(key, { clientX: 10, clientY: 10 })
  const chips = screen.getByRole('list', { name: 'Labels' })
  expect(chips.children).toHaveLength(5)
  // Dark labels get white text, light ones black; a label without a color stays neutral.
  expect((screen.getByText('bug') as HTMLElement).style.color).toBe('rgb(255, 255, 255)')
  expect((screen.getByText('good first issue') as HTMLElement).style.color).toBe('rgb(0, 0, 0)')
  expect((screen.getByText('plain') as HTMLElement).style.color).toBe('')
  // White only while it reads: a mid blue takes black text, violet takes white.
  expect((screen.getByText('blue') as HTMLElement).style.color).toBe('rgb(0, 0, 0)')
  expect((screen.getByText('violet') as HTMLElement).style.color).toBe('rgb(255, 255, 255)')
  expect(screen.getByText('bug').getAttribute('title')).toBe('bug')
  expect(screen.getByText('bug').className).toContain('truncate')
  expect(screen.getByText('sam-lee')).toBeTruthy()
  expect(screen.queryByText('Priority')).toBeNull()
})

test('the mini-card of a task without labels or extra rows is as before', () => {
  renderCard({ key: 'DEMO-1', collapsed: true }, { 'DEMO-1': task })
  const key = screen.getByText('DEMO-1')
  fireEvent.pointerDown(key, { clientX: 10, clientY: 10 })
  fireEvent.click(key, { clientX: 10, clientY: 10 })
  expect(screen.getByText('Priority')).toBeTruthy()
  expect(screen.queryByRole('list', { name: 'Labels' })).toBeNull()
})
