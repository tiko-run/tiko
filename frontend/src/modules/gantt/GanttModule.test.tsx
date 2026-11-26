import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Node } from '@xyflow/react'
import { useLayoutEffect } from 'react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { Task } from '@/api/tasks'
import { moduleControls } from '@/canvas/module-controls'
import { ReadOnlyContext } from '@/canvas/readonly'
import { trackInputModality } from '@/lib/input-modality'
import { ModuleNode } from '@/canvas/nodes/ModuleNode'
import { TasksContext } from '@/canvas/tasks-context'
import type { AppNode, ModuleNode as ModuleNodeType } from '@/canvas/types'
import { ModuleHostContext } from '@/modules/host-context'
import type { GanttContent } from '@/modules/gantt/schema'
import { parseDay } from '@/modules/gantt/timeline'
import type { ModuleHost } from '@/modules/types'
import { PlanningContext, type PlanningState } from '@/planning/context'

const nodeTypes = { module: ModuleNode }

const toast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))

beforeAll(() => {
  // xyflow measures nodes and bars capture the pointer; jsdom has neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.setPointerCapture ??= () => {}
})

const task: Task = {
  source: 'demo',
  key: 'DEMO-1',
  state: 'ok',
  summary: 'Rotate the staging certificates',
  status_name: 'Done',
  status_category: 'done',
  type_name: 'Task',
  assignee_name: null,
  priority_name: null,
  updated: null,
  url: 'https://jira.example.com/browse/DEMO-1',
  fetched_at: '2026-10-05T07:00:00Z',
}

const content: GanttContent = {
  start: '2026-10-01',
  end: '2026-12-31',
  scale: 'week',
  labelWidth: 160,
  rows: [
    { id: 'a', key: 'DEMO-1', title: '', start: '2026-10-05', end: '2026-10-09' },
    { id: 'b', title: 'Design review', start: '2026-10-12', end: '2026-10-14' },
  ],
  milestones: [],
  links: [],
}

let latest: Node[] = []
// A second Gantt on the board, for the tests that need two; set before rendering.
let second: GanttContent | null = null
// Writes a Gantt's content as someone else in the room would.
let remote: (id: string, content: GanttContent) => void = () => {}

function Board({ start }: { start: GanttContent }) {
  const [nodes, , onNodesChange] = useNodesState<AppNode>([
    {
      id: 'g',
      type: 'module',
      position: { x: 0, y: 0 },
      width: 960,
      height: 320,
      selected: true,
      data: { kind: 'gantt', content: start },
    },
    ...(second
      ? [
          {
            id: 'h',
            type: 'module' as const,
            position: { x: 0, y: 400 },
            width: 960,
            height: 320,
            data: { kind: 'gantt', content: second },
          },
        ]
      : []),
  ])
  const { updateNodeData } = useReactFlow()
  remote = (id, content) => updateNodeData(id, { content })
  useLayoutEffect(() => {
    latest = nodes
  }, [nodes])
  return (
    <>
      {/* The canvas puts these in the selection bar. */}
      {moduleControls(
        nodes[0] as ModuleNodeType,
        (content) => updateNodeData('g', { content }),
        'top',
      )}
      {/* Shift adds to the selection, as on the board. */}
      <ReactFlow
        nodes={nodes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        multiSelectionKeyCode="Shift"
      />
    </>
  )
}

const OFF: PlanningState = {
  enabled: false,
  types: [],
  people: [],
  fields: [],
  views: [],
  daysOff: [],
}

function renderGantt(
  host: Partial<ModuleHost> = {},
  start = content,
  planning = OFF,
  tasks: Record<string, Task> = { 'DEMO-1': task },
  readOnly = false,
) {
  const full: ModuleHost = {
    addTasks: vi.fn(),
    ejectCard: vi.fn(),
    ejectNote: vi.fn(),
    syncContent: vi.fn(),
    ...host,
  }
  render(
    <div style={{ width: 1200, height: 800 }}>
      <QueryClientProvider client={new QueryClient()}>
        <ReadOnlyContext.Provider value={readOnly}>
          <ReactFlowProvider>
            <TasksContext.Provider value={tasks}>
              <ModuleHostContext.Provider value={full}>
                <PlanningContext.Provider value={planning}>
                  <Board start={start} />
                </PlanningContext.Provider>
              </ModuleHostContext.Provider>
            </TasksContext.Provider>
          </ReactFlowProvider>
        </ReadOnlyContext.Provider>
      </QueryClientProvider>
    </div>,
  )
  return full
}

const current = () => (latest[0].data as { content: GanttContent }).content
const rows = () => current().rows

test('shows task rows with live data and plain rows with their title', () => {
  renderGantt()
  expect(screen.getByText('Rotate the staging certificates')).toBeTruthy()
  expect(screen.getByRole('slider', { name: 'Design review dates' })).toBeTruthy()
  const bar = screen.getByRole('slider', { name: /DEMO-1/ })
  expect(bar.className).toContain('bg-status-done')
  expect(bar.className).toContain('line-through')
})

test('adds a plain row and removes a row', () => {
  renderGantt()
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Plain task' }))
  const field = screen.getByLabelText('Title')
  fireEvent.change(field, { target: { value: 'Kickoff' } })
  fireEvent.submit(field)
  expect(rows().map((r) => r.title)).toContain('Kickoff')
  expect(rows()).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: 'Remove Design review' }))
  expect(rows().map((r) => r.id)).not.toContain('b')
})

test('renames a plain row in place', () => {
  renderGantt()
  // The press captures the pointer, so the browser sends the double-click to the row itself.
  fireEvent.doubleClick(screen.getAllByText('Design review')[0].closest('.group\\/label')!)
  const field = screen.getByLabelText('Row title')
  fireEvent.change(field, { target: { value: 'Security review' } })
  fireEvent.blur(field)
  expect(rows()[1].title).toBe('Security review')
})

test('a row dragged out of the module goes back to the board', () => {
  const host = renderGantt()
  const label = screen.getByText('DEMO-1')
  fireEvent.pointerDown(label, { clientX: 10, clientY: 10, pointerId: 1 })
  fireEvent.pointerMove(label, { clientX: 2000, clientY: 2000, pointerId: 1 })
  fireEvent.pointerUp(label, { clientX: 2000, clientY: 2000, pointerId: 1 })
  expect(host.ejectCard).toHaveBeenCalledWith({ key: 'DEMO-1' }, { x: 2000, y: 2000 })
  expect(rows().map((r) => r.id)).toEqual(['b'])
})

test('the task column is resized by dragging its border, within limits', () => {
  renderGantt()
  const grip = screen.getByRole('separator', { name: 'Resize the task column' })
  fireEvent.pointerDown(grip, { clientX: 160, pointerId: 1 })
  fireEvent.pointerMove(grip, { clientX: 260, pointerId: 1 })
  fireEvent.pointerUp(grip, { pointerId: 1 })
  const width = () => (latest[0].data as { content: GanttContent }).content.labelWidth
  expect(width()).toBe(260)
  fireEvent.pointerDown(grip, { clientX: 260, pointerId: 1 })
  fireEvent.pointerMove(grip, { clientX: -500, pointerId: 1 })
  expect(width()).toBe(120)
})

test('the module title is renamed in its header', () => {
  renderGantt()
  fireEvent.doubleClick(screen.getByText('Gantt'))
  const field = screen.getByLabelText('Gantt')
  fireEvent.change(field, { target: { value: 'Q4 roadmap' } })
  fireEvent.blur(field)
  expect((latest[0].data as { title?: string }).title).toBe('Q4 roadmap')
  expect(screen.getByText('Q4 roadmap')).toBeTruthy()
})

test('rows nest under rows, show a summary bar and collapse', () => {
  renderGantt()
  fireEvent.click(screen.getByRole('button', { name: 'Indent Design review' }))
  expect(rows()[1].parent).toBe('a')
  expect(screen.getByRole('slider', { name: /DEMO-1 .* summary/ })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Add a task under Design review' }))
  expect(rows().map((r) => r.parent)).toEqual([undefined, 'a', 'b'])
  fireEvent.blur(screen.getByLabelText('Row title'))

  fireEvent.click(screen.getByRole('button', { name: 'Collapse DEMO-1' }))
  expect(rows()[0].collapsed).toBe(true)
  expect(screen.queryByRole('slider', { name: 'Design review dates' })).toBeNull()
})

test('removing a parent keeps its children one level up', () => {
  renderGantt()
  fireEvent.click(screen.getByRole('button', { name: 'Indent Design review' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove DEMO-1' }))
  expect(rows()).toEqual([expect.objectContaining({ id: 'b' })])
  expect(rows()[0].parent).toBeUndefined()
})

test('a task row links to the tracker from its own button only', () => {
  renderGantt()
  const link = screen.getByRole('link', { name: 'Open DEMO-1 in the tracker' })
  expect(link.getAttribute('href')).toBe(task.url)
  expect(screen.getByText('DEMO-1').closest('a')).toBeNull()
})

test('a task that becomes a parent keeps its key, title and status color', () => {
  renderGantt()
  fireEvent.click(screen.getByRole('button', { name: 'Indent Design review' }))
  const summary = screen.getByRole('slider', { name: /DEMO-1 .* summary/ })
  expect(summary.textContent).toContain('Rotate the staging certificates')
  expect(summary.className).toContain('bg-status-done')
})

test('dragging a parent moves its whole branch', () => {
  renderGantt()
  fireEvent.click(screen.getByRole('button', { name: 'Indent Design review' }))
  const summary = screen.getByRole('slider', { name: /DEMO-1 .* summary/ })
  // 92 days over 800px: about 8.7px a day, so 87px is ten days.
  fireEvent.pointerDown(summary, { clientX: 100, pointerId: 1 })
  fireEvent.pointerMove(summary, { clientX: 187, pointerId: 1 })
  fireEvent.pointerUp(summary, { pointerId: 1 })
  expect(rows().map((r) => [r.start, r.end])).toEqual([
    ['2026-10-15', '2026-10-19'],
    ['2026-10-22', '2026-10-24'],
  ])
})

test('stretching a parent grows its own dates and leaves the child alone', () => {
  renderGantt()
  fireEvent.click(screen.getByRole('button', { name: 'Indent Design review' }))
  const summary = screen.getByRole('slider', { name: /DEMO-1 .* summary/ })
  const end = summary.querySelectorAll('.cursor-ew-resize')[1]
  // About ten days to the right.
  fireEvent.pointerDown(end, { clientX: 100, pointerId: 1 })
  fireEvent.pointerMove(end, { clientX: 187, pointerId: 1 })
  fireEvent.pointerUp(end, { pointerId: 1 })
  expect(rows().map((r) => [r.start, r.end])).toEqual([
    ['2026-10-05', '2026-10-24'],
    ['2026-10-12', '2026-10-14'],
  ])
})

test('adds a milestone in the middle of the range, renames, drags and removes it', () => {
  renderGantt()
  fireEvent.click(screen.getByRole('button', { name: 'Milestone' }))
  expect(current().milestones).toEqual([
    { id: expect.any(String), date: '2026-11-15', title: 'Milestone' },
  ])
  const milestone = screen.getByTestId('gantt-milestone')
  // The drag captures the pointer, so the browser sends the double-click to the milestone itself.
  fireEvent.doubleClick(milestone)
  const field = screen.getByLabelText('Milestone title')
  fireEvent.change(field, { target: { value: 'Beta' } })
  fireEvent.blur(field)
  expect(current().milestones[0].title).toBe('Beta')
  // About ten days to the left.
  fireEvent.pointerDown(milestone, { clientX: 300, pointerId: 1 })
  fireEvent.pointerMove(milestone, { clientX: 213, pointerId: 1 })
  fireEvent.pointerUp(milestone, { pointerId: 1 })
  expect(current().milestones[0].date).toBe('2026-11-05')
  fireEvent.click(screen.getByRole('button', { name: 'Remove Beta' }))
  expect(current().milestones).toEqual([])
})

test('dragging a bar handle onto another row links them', () => {
  renderGantt()
  const target = document.querySelector('[data-gantt-row="b"]')!
  document.elementFromPoint = () => target
  const [handle] = screen.getAllByRole('button', { name: 'Drag to another task to link it' })
  fireEvent.pointerDown(handle, { clientX: 100, clientY: 10, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: 150, clientY: 40, pointerId: 1 })
  fireEvent.pointerUp(handle, { clientX: 150, clientY: 40, pointerId: 1 })
  expect(current().links).toEqual([{ id: expect.any(String), from: 'a', to: 'b' }])
  expect(screen.getByTestId('gantt-link').getAttribute('data-conflict')).toBeNull()
})

test('a link that starts too early is drawn as a warning and can be removed', () => {
  const early = {
    ...content,
    rows: [content.rows[0], { ...content.rows[1], start: '2026-10-08' }],
    links: [{ id: 'l1', from: 'a', to: 'b' }],
  }
  renderGantt({}, early)
  const line = screen.getByTestId('gantt-link')
  expect(line.getAttribute('data-conflict')).toBe('true')
  fireEvent.pointerDown(within(line).getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'Remove the dependency' }))
  expect(current().links).toEqual([])
})

test('a bar shows its exact dates while it is dragged', () => {
  renderGantt()
  const bar = screen.getByRole('slider', { name: 'Design review dates' })
  const tip = () => within(bar.parentElement!).getByRole('tooltip', { hidden: true })
  expect(tip().textContent).toContain('Mon Oct 12 – Wed Oct 14 · 3 days')
  expect(tip().className).not.toMatch(/(^| )flex( |$)/)
  // About ten days to the right.
  fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 })
  fireEvent.pointerMove(bar, { clientX: 187, pointerId: 1 })
  expect(tip().className).toMatch(/(^| )flex( |$)/)
  expect(tip().textContent).toContain('Thu Oct 22 – Sat Oct 24 · 3 days')
  expect(tip().textContent).not.toContain('Design review')
  fireEvent.pointerUp(bar, { pointerId: 1 })
  expect(tip().className).not.toMatch(/(^| )flex( |$)/)
})

const PLANNING: PlanningState = {
  enabled: true,
  types: [
    { id: 't1', name: 'Discovery', hue: 75, archived: false },
    { id: 't3', name: 'Build', hue: 250, archived: false },
  ],
  people: [],
  fields: [],
  views: [],
  daysOff: [],
}
const press = (el: Element, from: number, to = from) => {
  fireEvent.pointerDown(el, { clientX: from, pointerId: 1, button: 0 })
  fireEvent.pointerMove(el, { clientX: to, pointerId: 1 })
  fireEvent.pointerUp(el, { clientX: to, pointerId: 1 })
}

test('with Planning off nothing about stages shows', () => {
  renderGantt()
  expect(screen.queryByText('No stage')).toBeNull()
  expect(document.querySelector('[data-gantt-stages]')).toBeNull()
})

test('with Planning on a bare bar becomes a stage when it gets a type', () => {
  renderGantt({}, content, PLANNING)
  press(screen.getByRole('button', { name: 'No stage stage of Design review' }), 400)
  fireEvent.click(screen.getByRole('button', { name: 'Build' }))
  expect(rows()[1].stages).toEqual([
    expect.objectContaining({ type: 't3', start: '2026-10-12', end: '2026-10-14' }),
  ])
  expect([rows()[1].start, rows()[1].end]).toEqual(['2026-10-12', '2026-10-14'])
})

test('a click on free days adds a week of the first type', () => {
  renderGantt({}, content, PLANNING)
  const track = document.querySelectorAll('[data-gantt-stages]')[1]
  press(track, 0)
  const stages = rows()[1].stages!
  expect(stages.map((s) => [s.type, s.start, s.end])).toEqual([
    ['t1', '2026-10-01', '2026-10-07'],
    ['', '2026-10-12', '2026-10-14'],
  ])
  expect(rows()[1].start).toBe('2026-10-01')
})

test('a stage dragged into its neighbour stops at it', () => {
  const start: GanttContent = {
    ...content,
    rows: [
      {
        id: 'a',
        title: 'Payment API',
        start: '2026-10-05',
        end: '2026-10-16',
        stages: [
          { id: 's1', type: 't1', start: '2026-10-05', end: '2026-10-07', people: [] },
          { id: 's2', type: 't3', start: '2026-10-12', end: '2026-10-16', people: [] },
        ],
      },
    ],
  }
  renderGantt({}, start, PLANNING)
  press(screen.getByRole('button', { name: 'Build stage of Payment API' }), 500, 0)
  expect(rows()[0].stages![1]).toMatchObject({ start: '2026-10-08', end: '2026-10-12' })
  expect(rows()[0].end).toBe('2026-10-12')
})

const pushable: GanttContent = {
  ...content,
  rows: [
    {
      id: 'a',
      title: 'Payment API',
      start: '2026-10-05',
      end: '2026-10-23',
      stages: [
        { id: 's1', type: 't1', start: '2026-10-05', end: '2026-10-07', people: [] },
        { id: 's2', type: 't3', start: '2026-10-12', end: '2026-10-16', people: [] },
        { id: 's3', type: 't1', start: '2026-10-19', end: '2026-10-23', people: [] },
      ],
    },
  ],
}
const starts = () => rows()[0].stages!.map((s) => parseDay(s.start))

test('a stage dragged right with Alt pushes the later ones; without Alt it stops at the next', () => {
  renderGantt({}, pushable, PLANNING)
  const bar = screen.getAllByRole('button', { name: 'Discovery stage of Payment API' })[0]
  const before = starts()
  fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1, button: 0 })
  fireEvent.pointerMove(bar, { clientX: 150, pointerId: 1, altKey: true })
  fireEvent.pointerUp(bar, { clientX: 150, pointerId: 1 })
  const days = starts()[0] - before[0]
  expect(days).toBeGreaterThan(0)
  expect(starts()).toEqual(before.map((d) => d + days))

  press(bar, 150, 400)
  const [s1, s2, s3] = rows()[0].stages!
  expect(parseDay(s1.end)).toBe(parseDay(s2.start) - 1)
  expect([s2.start, s3.start].map(parseDay)).toEqual([before[1] + days, before[2] + days])
})

test('Collapse all and Expand all fold every parent in one change, hidden for viewers', () => {
  const nested: GanttContent = {
    ...content,
    rows: [
      { id: 'p', title: 'Launch', start: '2026-10-05', end: '2026-10-14' },
      { id: 'c', title: 'Design review', parent: 'p', start: '2026-10-12', end: '2026-10-14' },
      { id: 'g', title: 'Copy', parent: 'c', start: '2026-10-12', end: '2026-10-13' },
    ],
  }
  renderGantt({}, nested)
  fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
  expect(rows().map((r) => Boolean(r.collapsed))).toEqual([true, true, false])
  expect(screen.queryByRole('slider', { name: 'Design review dates' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
  expect(rows().map((r) => Boolean(r.collapsed))).toEqual([false, false, false])
  expect(screen.getByRole('slider', { name: 'Copy dates' })).toBeTruthy()
})

test('a viewer gets no fold-all buttons', () => {
  renderGantt(
    {},
    { ...content, rows: [content.rows[0], { ...content.rows[1], parent: 'a' }] },
    OFF,
    {
      'DEMO-1': task,
    },
    true,
  )
  expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull()
})

test('each stage has a tooltip of its own', () => {
  const start: GanttContent = {
    ...content,
    rows: [
      {
        id: 'a',
        title: 'Payment API',
        start: '2026-10-05',
        end: '2026-10-16',
        stages: [
          { id: 's1', type: 't1', start: '2026-10-05', end: '2026-10-07', people: [] },
          { id: 's2', type: 't3', start: '2026-10-12', end: '2026-10-16', people: [] },
        ],
      },
    ],
  }
  renderGantt({}, start, PLANNING)
  const bars = screen.getAllByRole('button', { name: /stage of Payment API/ })
  // `peer-hover` reaches only siblings, so each bar and its tip share a box of their own.
  expect(bars[0].parentElement).not.toBe(bars[1].parentElement)
  expect(bars[0].parentElement!.querySelectorAll('[role=tooltip]')).toHaveLength(1)
})

test('removing the last child of a stretched row brings its dates back to its stages', () => {
  const start: GanttContent = {
    ...content,
    rows: [
      {
        id: 'a',
        title: 'Payment API',
        start: '2026-10-01',
        end: '2026-10-30',
        stages: [{ id: 's1', type: 't1', start: '2026-10-05', end: '2026-10-09', people: [] }],
      },
      { id: 'b', title: 'Child', start: '2026-10-12', end: '2026-10-14', parent: 'a' },
    ],
  }
  renderGantt({}, start, PLANNING)
  fireEvent.click(screen.getByRole('button', { name: 'Remove Child' }))
  expect([rows()[0].start, rows()[0].end]).toEqual(['2026-10-05', '2026-10-09'])
})

const PEOPLE: PlanningState = {
  ...PLANNING,
  people: [
    { id: 'p1', name: 'Ivan', teams: ['Core'], source: 'manual', archived: false, off: [] },
    { id: 'p2', name: 'Anna', teams: [], source: 'manual', archived: true, off: [] },
  ],
}
const staged = (people: string[], extra: Partial<GanttContent> = {}): GanttContent => ({
  ...content,
  ...extra,
  rows: [
    {
      id: 'a',
      title: 'Payment API',
      start: '2026-10-12',
      end: '2026-10-16',
      stages: [{ id: 's1', type: 't3', start: '2026-10-12', end: '2026-10-16', people }],
    },
  ],
})

test('people show after the stage type, an archived one muted', () => {
  renderGantt({}, staged(['p1', 'p2']), PEOPLE)
  const bar = screen.getByRole('button', { name: 'Build stage of Payment API' })
  expect(bar.textContent).toBe('Build · Ivan, Anna')
  expect(within(bar).getByText('Anna').className).toContain('opacity-60')
  expect(within(bar).getByText('Ivan').className).not.toContain('opacity-60')
})

test('a stage bar takes the focus and opens its popover with Enter or Space', async () => {
  trackInputModality()
  renderGantt({}, staged(['p1']), PEOPLE)
  const bar = screen.getByRole('button', { name: 'Build stage of Payment API' })
  expect(bar.tabIndex).toBe(0)
  expect(bar.getAttribute('aria-expanded')).toBe('false')
  // A key on something inside the bar is not the bar's own.
  fireEvent.keyDown(within(bar).getByText('Ivan'), { key: 'Enter' })
  expect(screen.queryByLabelText('Add a person')).toBeNull()
  fireEvent.keyDown(document.body, { key: 'Tab' })
  bar.focus()
  fireEvent.keyDown(bar, { key: 'Enter' })
  expect(screen.getByLabelText('Add a person')).toBeTruthy()
  expect(bar.getAttribute('aria-expanded')).toBe('true')
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByLabelText('Add a person')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(bar))
  fireEvent.keyDown(bar, { key: ' ' })
  expect(screen.getByLabelText('Add a person')).toBeTruthy()
})

test('names below the bars make the rows taller', () => {
  renderGantt({}, staged(['p1'], { people: 'below' }), PEOPLE)
  const bar = screen.getByRole('button', { name: 'Build stage of Payment API' })
  expect(bar.textContent).toBe('Build')
  const row = bar.closest('[data-gantt-row]') as HTMLElement
  expect(row.style.height).toBe('50px')
  const line = row.querySelector('[data-stage-people]') as HTMLElement
  expect(line.textContent).toBe('Ivan')
  expect(line.className).toContain('justify-center')
})

test('names below are ignored with Planning off', () => {
  renderGantt({}, staged(['p1'], { people: 'below' }), OFF)
  const row = document.querySelector('[data-gantt-row]') as HTMLElement
  expect(row.style.height).toBe('34px')
})

test('the popover adds someone from the list and removes them again', () => {
  renderGantt({}, staged([]), PEOPLE)
  press(screen.getByRole('button', { name: 'Build stage of Payment API' }), 500)
  const field = screen.getByLabelText('Add a person')
  fireEvent.change(field, { target: { value: 'iv' } })
  // Anna is archived: she is not offered again.
  expect(screen.queryByRole('option', { name: /Anna/ })).toBeNull()
  fireEvent.click(screen.getByRole('option', { name: /Ivan/ }))
  expect(rows()[0].stages![0].people).toEqual(['p1'])
  fireEvent.click(screen.getByRole('button', { name: 'Remove Ivan' }))
  expect(rows()[0].stages![0].people).toEqual([])
})

test('an unknown name is added to the people on the fly', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json({
      id: 'p9',
      teams: [],
      archived: false,
      off: [],
      ...JSON.parse(String(init?.body)),
      source: 'manual',
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  try {
    renderGantt({}, staged([]), PEOPLE)
    press(screen.getByRole('button', { name: 'Build stage of Payment API' }), 500)
    fireEvent.change(screen.getByLabelText('Add a person'), { target: { value: 'Petra' } })
    fireEvent.click(screen.getByRole('option', { name: '+ Add “Petra” to people' }))
    await vi.waitFor(() => expect(rows()[0].stages![0].people).toEqual(['p9']))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/planning/people',
      expect.objectContaining({ method: 'POST', body: '{"name":"Petra","source":"manual"}' }),
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test('names that do not fit turn into a count that lists them', () => {
  // jsdom lays nothing out: the names are as wide as the hidden copy says.
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500)
  try {
    renderGantt({}, staged(['p1', 'p2']), PEOPLE)
    const bar = screen.getByRole('button', { name: 'Build stage of Payment API' })
    expect(bar.textContent).toBe('Build2')
    // Pointer only: the stage popover gives keyboard and screen readers the same list.
    const count = within(bar).getByLabelText('2 people on Build')
    fireEvent.pointerDown(count, { pointerId: 1, button: 0 })
    fireEvent.pointerUp(count, { pointerId: 1 })
    fireEvent.click(count)
    expect(screen.getByText('People on Build')).toBeTruthy()
    const anna = screen.getAllByRole('listitem').find((li) => li.textContent === 'Anna')!
    expect(anna.className).toContain('opacity-60')
    // Its own list, not the stage's popover.
    expect(screen.queryByLabelText('Add a person')).toBeNull()
  } finally {
    width.mockRestore()
  }
})

test('a second click on a stage closes its popover', async () => {
  renderGantt({}, staged(['p1']), PEOPLE)
  const bar = screen.getByRole('button', { name: 'Build stage of Payment API' })
  // The popover listens for clicks outside it from the next tick on.
  const tick = () => act(() => new Promise((done) => setTimeout(done, 0)))
  press(bar, 500)
  await tick()
  expect(screen.getByLabelText('Add a person')).toBeTruthy()
  // A click on the bar moves focus to the canvas node around it: not a reason to close.
  fireEvent.focusIn(bar.closest('.react-flow__node')!)
  await tick()
  expect(screen.getByLabelText('Add a person')).toBeTruthy()
  // In a browser the press moves focus to the node and the popover closes before the release;
  // jsdom does not close on focus, Escape stands in for it.
  fireEvent.pointerDown(bar, { clientX: 500, pointerId: 1, button: 0 })
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  await tick()
  fireEvent.pointerUp(bar, { clientX: 500, pointerId: 1 })
  await tick()
  expect(screen.queryByLabelText('Add a person')).toBeNull()
  press(bar, 500)
  await tick()
  expect(screen.getByLabelText('Add a person')).toBeTruthy()
  press(bar, 500)
  await tick()
  expect(screen.queryByLabelText('Add a person')).toBeNull()
})

test('an assignee of a task in this Gantt is added from the tracker when picked', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json({
      id: 'p7',
      teams: [],
      archived: false,
      off: [],
      ...JSON.parse(String(init?.body)),
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  try {
    const start = staged([])
    start.rows[0] = { ...start.rows[0], key: 'DEMO-1', source: 'demo' }
    renderGantt({}, start, PEOPLE, { 'demo:DEMO-1': { ...task, assignee_name: 'Oleg' } })
    press(screen.getByRole('button', { name: 'Build stage of Payment API' }), 500)
    fireEvent.focus(screen.getByLabelText('Add a person'))
    // Nobody is added until picked.
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: /Oleg.*From tracker/ }))
    await vi.waitFor(() => expect(rows()[0].stages![0].people).toEqual(['p7']))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/planning/people',
      expect.objectContaining({ body: '{"name":"Oleg","source":"tracker"}' }),
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

const AWAY: PlanningState = {
  ...PEOPLE,
  people: [
    {
      ...PEOPLE.people[0],
      off: [{ id: 'o1', start: '2026-10-14', end: '2026-10-20' }],
    },
    { id: 'p3', name: 'Mia', teams: ['Web'], source: 'manual', archived: false, off: [] },
  ],
}

test('no Time off lane while nobody on this Gantt is away', () => {
  renderGantt({}, staged(['p1']), PEOPLE)
  expect(document.querySelector('[data-gantt-timeoff]')).toBeNull()
  expect(screen.queryByText('Time off')).toBeNull()
})

test('no Time off lane for someone away who has no stage here', () => {
  renderGantt({}, staged(['p3']), AWAY)
  expect(document.querySelector('[data-gantt-timeoff]')).toBeNull()
})

test('time off shows on the lane and marks the stage it falls on', () => {
  renderGantt({}, staged(['p1']), AWAY)
  expect(document.querySelector('[data-gantt-timeoff]')).toBeTruthy()
  expect(screen.getByText('Time off')).toBeTruthy()
  expect(screen.getByRole('button', { name: /^Ivan is away Wed Oct 14 – Tue Oct 20/ })).toBeTruthy()
  const bar = screen.getByRole('button', { name: 'Build stage of Payment API' })
  expect(within(bar).getByLabelText('Someone is away')).toBeTruthy()
  expect(bar.style.boxShadow).toContain('var(--destructive)')
  const tip = within(bar.parentElement!).getByRole('tooltip', { hidden: true })
  expect(tip.textContent).toContain('Ivan is away Wed Oct 14 – Tue Oct 20')
  press(bar, 500)
  const lines = screen.getAllByText('Ivan is away Wed Oct 14 – Tue Oct 20')
  expect(lines.some((line) => line.className.includes('text-destructive'))).toBe(true)
})

test('a stage clear of the time off has no mark', () => {
  const start = staged(['p1'])
  start.rows[0].stages![0] = { ...start.rows[0].stages![0], end: '2026-10-13' }
  start.rows[0].end = '2026-10-13'
  renderGantt({}, start, AWAY)
  const bar = screen.getByRole('button', { name: 'Build stage of Payment API' })
  expect(within(bar).queryByLabelText('Someone is away')).toBeNull()
  expect(bar.style.boxShadow).not.toContain('destructive')
})

test('the lane pushes the rows down so the body grows', () => {
  renderGantt({}, staged(['p1']), AWAY)
  const lane = document.querySelector('[data-gantt-timeoff]') as HTMLElement
  expect(parseInt(lane.style.height)).toBeGreaterThan(0)
})

test('a drag across the lane marks the picked person away', async () => {
  const fetchMock = vi.fn(async () => Response.json(AWAY.people[1]))
  vi.stubGlobal('fetch', fetchMock)
  try {
    renderGantt({}, staged(['p1']), AWAY)
    const lane = document.querySelector('[data-gantt-timeoff]') as HTMLElement
    // A click marks a week from the day under it.
    press(lane, 600)
    expect(screen.getByText('Who is away?')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'mi' } })
    expect(screen.queryByRole('option', { name: /Ivan/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Mia/ }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/planning/people/p3/off')
    const body = JSON.parse(String(init.body))
    expect(Object.keys(body)).toEqual(['start', 'end'])
    const days = (Date.parse(body.end) - Date.parse(body.start)) / 86_400_000
    expect(days).toBe(6)
  } finally {
    vi.unstubAllGlobals()
  }
})

test('time off is removed from its popover', async () => {
  const fetchMock = vi.fn(async () => Response.json({ ...AWAY.people[0], off: [] }))
  vi.stubGlobal('fetch', fetchMock)
  try {
    renderGantt({}, staged(['p1']), AWAY)
    fireEvent.click(screen.getByRole('button', { name: /^Ivan is away/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove time off' }))
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/planning/people/p1/off/o1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test('a second click on time off closes its popover', async () => {
  renderGantt({}, staged(['p1']), AWAY)
  const bar = screen.getByRole('button', { name: /^Ivan is away/ })
  const tick = () => act(() => new Promise((done) => setTimeout(done, 0)))
  const click = async (closeOnPress = false) => {
    fireEvent.pointerDown(bar, { pointerId: 1, button: 0 })
    // In a browser the press moves focus and the popover closes before the click;
    // jsdom does not close on focus, Escape stands in for it.
    if (closeOnPress) fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await tick()
    fireEvent.pointerUp(bar, { pointerId: 1 })
    fireEvent.click(bar)
    await tick()
  }
  await click()
  expect(screen.getByRole('button', { name: 'Remove time off' })).toBeTruthy()
  await click(true)
  expect(screen.queryByRole('button', { name: 'Remove time off' })).toBeNull()
  await click()
  expect(screen.getByRole('button', { name: 'Remove time off' })).toBeTruthy()
  await click()
  expect(screen.queryByRole('button', { name: 'Remove time off' })).toBeNull()
})

test('the keyboard opens and closes the time off popover', async () => {
  renderGantt({}, staged(['p1']), AWAY)
  const bar = screen.getByRole('button', { name: /^Ivan is away/ })
  const tick = () => act(() => new Promise((done) => setTimeout(done, 0)))
  // A mouse click first leaves its press behind; the keyboard must not reuse it.
  fireEvent.pointerDown(bar, { pointerId: 1, button: 0 })
  fireEvent.pointerUp(bar, { pointerId: 1 })
  fireEvent.click(bar)
  await tick()
  expect(screen.getByRole('button', { name: 'Remove time off' })).toBeTruthy()
  fireEvent.click(bar)
  await tick()
  expect(screen.queryByRole('button', { name: 'Remove time off' })).toBeNull()
  fireEvent.click(bar)
  await tick()
  expect(screen.getByRole('button', { name: 'Remove time off' })).toBeTruthy()
})

const FIELDS: PlanningState = {
  ...PLANNING,
  fields: [
    { id: 'priority', name: 'Priority', standard: true, archived: false },
    { id: 'f7', name: 'Quarter', standard: false, archived: false },
  ],
}
const tree = (extra: Partial<GanttContent> = {}): GanttContent => ({
  ...content,
  rows: [
    {
      id: 'p',
      title: 'Checkout redesign',
      start: '2026-10-05',
      end: '2026-10-09',
      values: { f7: 'Q4' },
    },
    { id: 'c', title: 'Payment API', start: '2026-10-05', end: '2026-10-09', parent: 'p' },
  ],
  columns: ['f7'],
  ...extra,
})

test('no columns with Planning off', () => {
  renderGantt({}, tree(), OFF)
  expect(document.querySelector('[data-gantt-columns]')).toBeNull()
})

test('a child shows the parent value muted and overrides it with its own', () => {
  renderGantt({}, tree(), FIELDS)
  expect(screen.getByText('Quarter')).toBeTruthy()
  const parent = screen.getByLabelText('Quarter of Checkout redesign') as HTMLInputElement
  const child = screen.getByLabelText('Quarter of Payment API') as HTMLInputElement
  expect(parent.value).toBe('Q4')
  expect([child.value, child.placeholder]).toEqual(['', 'Q4'])
  fireEvent.focus(child)
  fireEvent.change(child, { target: { value: 'Q1' } })
  fireEvent.keyDown(child, { key: 'Enter' })
  fireEvent.blur(child)
  expect(rows()[1].values).toEqual({ f7: 'Q1' })
})

test('clearing a cell inherits again; Escape keeps the old value', () => {
  renderGantt({}, tree(), FIELDS)
  const parent = screen.getByLabelText('Quarter of Checkout redesign')
  fireEvent.focus(parent)
  fireEvent.change(parent, { target: { value: 'Q9' } })
  fireEvent.keyDown(parent, { key: 'Escape' })
  fireEvent.blur(parent)
  expect(rows()[0].values).toEqual({ f7: 'Q4' })
  fireEvent.focus(parent)
  fireEvent.change(parent, { target: { value: '' } })
  fireEvent.blur(parent)
  expect(rows()[0]).not.toHaveProperty('values')
})

test('the column picker shows and hides a field', () => {
  renderGantt({}, tree({ columns: undefined }), FIELDS)
  fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
  fireEvent.click(screen.getByRole('button', { name: 'Priority' }))
  expect(current().columns).toEqual(['priority'])
  fireEvent.click(screen.getByRole('button', { name: 'Priority', pressed: true }))
  expect(current()).not.toHaveProperty('columns')
})

test('a new field from the picker becomes a column', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ id: 'f9', name: 'Budget code', standard: false, archived: false }),
  )
  vi.stubGlobal('fetch', fetchMock)
  try {
    renderGantt({}, tree(), FIELDS)
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    const field = screen.getByLabelText('New field')
    fireEvent.change(field, { target: { value: 'Budget code' } })
    fireEvent.submit(field)
    await vi.waitFor(() => expect(current().columns).toEqual(['f7', 'f9']))
  } finally {
    vi.unstubAllGlobals()
  }
})

const VIEWS: PlanningState = {
  ...FIELDS,
  fields: [...FIELDS.fields, { id: 'team', name: 'Team', standard: true, archived: false }],
  views: [{ id: 'v1', name: 'Next quarter', filters: { f7: ['Q1'] } }],
}

test('no filter bar with Planning off', () => {
  renderGantt({}, tree({ filters: { f7: ['Q1'] } }), OFF)
  expect(document.querySelector('[data-gantt-filters]')).toBeNull()
  expect(screen.getAllByText('Payment API').length).toBeGreaterThan(0)
})

test('a filter picked from "+ Filter" hides rows and shows a chip', () => {
  renderGantt({}, tree(), VIEWS)
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
  fireEvent.click(screen.getByRole('button', { name: 'Quarter' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Q4' }))
  expect(current().filters).toEqual({ f7: ['Q4'] })
  fireEvent.click(screen.getByRole('button', { name: 'Remove the Quarter filter' }))
  expect(current()).not.toHaveProperty('filters')
})

test('a filter that matches nothing says so and keeps its chip', () => {
  renderGantt({}, tree({ filters: { f7: ['Q3'] } }), VIEWS)
  expect(screen.getByText('No tasks match these filters.')).toBeTruthy()
  expect(screen.getByText('Quarter:')).toBeTruthy()
  expect(screen.queryByLabelText('Quarter of Payment API')).toBeNull()
})

test('a saved view applies its filters, a second click shows every task', () => {
  renderGantt({}, tree(), VIEWS)
  fireEvent.click(screen.getByRole('button', { name: 'Next quarter' }))
  expect(current().filters).toEqual({ f7: ['Q1'] })
  expect(screen.queryByRole('button', { name: 'Save as view' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Next quarter', pressed: true }))
  expect(current()).not.toHaveProperty('filters')
})

test('"Save as view" stores the filters for the instance', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json({ id: 'v2', ...JSON.parse(String(init?.body)) }),
  )
  vi.stubGlobal('fetch', fetchMock)
  try {
    renderGantt({}, tree({ filters: { f7: ['Q4'] } }), VIEWS)
    fireEvent.click(screen.getByRole('button', { name: 'Save as view' }))
    const name = screen.getByLabelText('View name')
    fireEvent.change(name, { target: { value: 'Q4 plan' } })
    fireEvent.submit(name)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/planning/views')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Q4 plan', filters: { f7: ['Q4'] } })
  } finally {
    vi.unstubAllGlobals()
  }
})

const WORK: GanttContent = {
  ...content,
  start: '2026-10-05',
  end: '2026-10-16',
  scale: 'day',
  workingDays: true,
  rows: [
    {
      id: 'a',
      title: 'Payment API',
      start: '2026-10-12',
      end: '2026-10-16',
      stages: [{ id: 's1', type: 't3', start: '2026-10-12', end: '2026-10-16', people: [] }],
    },
  ],
}

test('working days only is switched on in the Gantt options', () => {
  renderGantt({}, content, PLANNING)
  fireEvent.keyDown(screen.getByRole('button', { name: 'More Gantt options' }), { key: 'Enter' })
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Working days only' }))
  expect(current().workingDays).toBe(true)
})

test('with working days only weekends vanish and a day off is shaded and not counted', () => {
  renderGantt({}, WORK, { ...PLANNING, daysOff: ['2026-10-14'] })
  const body = document.querySelector('[data-gantt-body]')!
  // Two weeks of five days each: no Saturday 10 or Sunday 11.
  expect(within(body as HTMLElement).queryByText('10')).toBeNull()
  expect(within(body as HTMLElement).getByText('12')).toBeTruthy()
  expect(document.querySelectorAll('[data-gantt-day-off]')).toHaveLength(1)
  const stage = screen.getByRole('button', { name: 'Build stage of Payment API' })
  expect(stage.getAttribute('aria-description')).toBe('Mon Oct 12 – Fri Oct 16 · 4 days')
})

test('a click with working days only adds five working days', () => {
  renderGantt({}, WORK, PLANNING)
  press(document.querySelector('[data-gantt-stages]')!, 0)
  expect(rows()[0].stages!.map((s) => [s.start, s.end])).toEqual([
    ['2026-10-05', '2026-10-09'],
    ['2026-10-12', '2026-10-16'],
  ])
})

test('working days are ignored with Planning off', () => {
  renderGantt({}, WORK)
  expect(screen.getByText('10')).toBeTruthy()
})

const following: GanttContent = {
  ...content,
  rows: [{ ...content.rows[0], follow: true }, content.rows[1]],
}

test('a following bar shows the tracker dates and the board keeps them outside undo', () => {
  const host = renderGantt({}, following, OFF, { 'DEMO-1': { ...task, due: '2026-10-30' } })
  const bar = screen.getByRole('slider', { name: /DEMO-1/ })
  // Only a due date: the start is a week before it, and drawn as a guess.
  expect(bar.getAttribute('aria-valuetext')).toBe('Sat Oct 24 – Fri Oct 30 · 7 days')
  expect(bar.getAttribute('data-guess')).toBe('start')
  expect(screen.getByText('Start is a guess: the tracker has only a due date')).toBeTruthy()
  const synced = (host.syncContent as ReturnType<typeof vi.fn>).mock.lastCall!
  expect(synced[0]).toBe('g')
  expect((synced[1] as GanttContent).rows[0]).toMatchObject({
    start: '2026-10-24',
    end: '2026-10-30',
    follow: true,
  })
})

test('dragging a following bar keeps the dragged dates, and Undo follows the tracker again', () => {
  toast.mockClear()
  renderGantt({}, following, OFF, {
    'DEMO-1': { ...task, start: '2026-10-05', due: '2026-10-09' },
  })
  const bar = screen.getByRole('slider', { name: /DEMO-1/ })
  // About ten days to the right.
  fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 })
  fireEvent.pointerMove(bar, { clientX: 187, pointerId: 1 })
  fireEvent.pointerUp(bar, { pointerId: 1 })
  expect(rows()[0]).toMatchObject({ start: '2026-10-15', end: '2026-10-19' })
  expect(rows()[0].follow).toBeUndefined()
  const [message, options] = toast.mock.lastCall!
  expect(message).toBe('The bar keeps your dates now, not the tracker’s')
  act(() => options.action.onClick())
  expect(rows()[0].follow).toBe(true)
})

test('a row with its own dates shows the tracker dates beside it and can follow them', () => {
  renderGantt({}, content, OFF, {
    'DEMO-1': { ...task, start: '2026-10-05', due: '2026-10-20' },
  })
  // The bar says it in words; the frame shows where, and its free part opens the choice.
  expect(screen.getByText('Tracker: Mon Oct 5 – Tue Oct 20')).toBeTruthy()
  expect(document.querySelector('[data-tracker-dates]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Tracker dates: Mon Oct 5 – Tue Oct 20' }))
  fireEvent.click(screen.getByRole('button', { name: 'Follow tracker dates' }))
  expect(rows()[0].follow).toBe(true)
})

test('a row cut into stages keeps its own dates and shows the tracker ones beside it', () => {
  const staged: GanttContent = {
    ...content,
    rows: [
      {
        ...content.rows[0],
        follow: true,
        stages: [{ id: 's', type: 'dev', start: '2026-10-05', end: '2026-10-09', people: [] }],
      },
    ],
  }
  const host = renderGantt({}, staged, OFF, {
    'DEMO-1': { ...task, start: '2026-11-02', due: '2026-11-20' },
  })
  expect(host.syncContent).not.toHaveBeenCalled()
  const bar = screen.getByRole('slider', { name: /DEMO-1/ })
  expect(bar.getAttribute('aria-valuetext')).toBe('Mon Oct 5 – Fri Oct 9 · 5 days')
  expect(screen.queryByRole('button', { name: /^Keep own dates for/ })).toBeNull()
})

test('stages fit into the tracker dates in equal shares at one press', () => {
  const staged: GanttContent = {
    ...content,
    rows: [
      {
        ...content.rows[0],
        start: '2026-10-05',
        end: '2026-10-30',
        stages: [
          { id: 's1', type: 'dev', start: '2026-10-05', end: '2026-10-09', people: [] },
          { id: 's2', type: 'qa', start: '2026-10-20', end: '2026-10-21', people: ['ann'] },
          { id: 's3', type: 'ops', start: '2026-10-25', end: '2026-10-30', people: [] },
        ],
      },
    ],
  }
  renderGantt({}, staged, OFF, { 'DEMO-1': { ...task, start: '2026-11-02', due: '2026-11-11' } })
  fireEvent.click(screen.getByRole('button', { name: /^Tracker dates:/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Fit stages to tracker dates' }))
  // Ten days for three stages: the day left over goes to the first.
  expect(rows()[0].stages!.map((s) => [s.start, s.end, s.people])).toEqual([
    ['2026-11-02', '2026-11-05', []],
    ['2026-11-06', '2026-11-08', ['ann']],
    ['2026-11-09', '2026-11-11', []],
  ])
  expect([rows()[0].start, rows()[0].end]).toEqual(['2026-11-02', '2026-11-11'])
  expect(rows()[0].follow).toBeUndefined()
  expect(document.querySelector('[data-tracker-dates]')).toBeNull()
})

test('a row stops and starts following from its own button', () => {
  renderGantt({}, following, OFF, { 'DEMO-1': { ...task, due: '2026-10-09' } })
  fireEvent.click(screen.getByRole('button', { name: /^Keep own dates for/ }))
  expect(rows()[0].follow).toBeUndefined()
  fireEvent.click(screen.getByRole('button', { name: /^Follow tracker dates for/ }))
  expect(rows()[0].follow).toBe(true)
})

test('a guest who cannot write leaves the board as it is', () => {
  const host = renderGantt({}, following, OFF, { 'DEMO-1': { ...task, due: '2026-10-30' } }, true)
  expect(host.syncContent).not.toHaveBeenCalled()
})

test('with Planning on a following bar marks its guessed side as with Planning off', () => {
  renderGantt({}, following, PLANNING, { 'DEMO-1': { ...task, due: '2026-10-30' } })
  const bar = screen.getByRole('button', { name: /stage of DEMO-1/ })
  expect(bar.getAttribute('aria-description')).toBe('Sat Oct 24 – Fri Oct 30 · 7 days')
  expect(bar.getAttribute('data-guess')).toBe('start')
  expect(screen.getByText('Start is a guess: the tracker has only a due date')).toBeTruthy()
})

test('tracker dates are written when this tab’s tracker data changes, not on every edit', () => {
  const host = renderGantt({}, following, OFF, { 'DEMO-1': { ...task, due: '2026-10-30' } })
  expect(host.syncContent).toHaveBeenCalledTimes(1)
  // An edit of another row leaves the stored dates as they are: someone else may have newer ones.
  fireEvent.click(screen.getByRole('button', { name: 'Indent Design review' }))
  expect(host.syncContent).toHaveBeenCalledTimes(1)
})

test('a viewer who cannot edit reads the tracker dates without a reason about children', () => {
  renderGantt(
    {},
    content,
    OFF,
    { 'DEMO-1': { ...task, start: '2026-10-05', due: '2026-10-20' } },
    true,
  )
  fireEvent.click(screen.getByRole('button', { name: /^Tracker dates:/ }))
  expect(screen.getByText('Mon Oct 5 – Tue Oct 20')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Follow tracker dates' })).toBeNull()
  expect(screen.queryByText('Rows with children keep their own dates.')).toBeNull()
})

test('a plain row is ticked done and back, a task row shows its tracker', () => {
  renderGantt()
  const tracked = screen.getByRole('checkbox', { name: 'Mark not done: DEMO-1' })
  expect(tracked.hasAttribute('disabled')).toBe(true)
  expect(tracked.getAttribute('title')).toBe('Done in the demo tracker')
  expect(screen.getByRole('slider', { name: /DEMO-1/ }).className).toContain('done-hatch')

  fireEvent.click(screen.getByRole('checkbox', { name: 'Mark done: Design review' }))
  expect(rows()[1].done).toBe(true)
  expect(screen.getByRole('slider', { name: 'Design review dates' }).className).toContain(
    'done-hatch',
  )
  expect(screen.getAllByText('Design review')[0].className).toContain('line-through')

  fireEvent.click(screen.getByRole('checkbox', { name: 'Mark not done: Design review' }))
  expect('done' in rows()[1]).toBe(false)
})

test('a parent shows done leaves of its whole branch', () => {
  renderGantt(
    {},
    {
      ...content,
      rows: [
        { id: 'p', title: 'Release', start: '2026-10-05', end: '2026-10-14' },
        { ...content.rows[0], parent: 'p' },
        { ...content.rows[1], parent: 'p' },
      ],
    },
  )
  expect(screen.getByTitle('1 of 2 done').textContent).toBe('1/2')
  expect(screen.queryByRole('checkbox', { name: /Release/ })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Mark done: Design review' }))
  expect(screen.getByTitle('2 of 2 done').className).toContain('text-status-done-foreground')
})

test('a viewer sees done marks but cannot tick', () => {
  renderGantt(
    {},
    { ...content, rows: [content.rows[0], { ...content.rows[1], done: true }] },
    OFF,
    undefined,
    true,
  )
  const box = screen.getByRole('checkbox', { name: 'Mark not done: Design review' })
  expect(box.hasAttribute('disabled')).toBe(true)
  expect(box.getAttribute('data-state')).toBe('checked')
})

test('with Planning on a done row without stages is hatched too', () => {
  renderGantt(
    {},
    { ...content, rows: [{ ...content.rows[1], done: true }] },
    { ...OFF, enabled: true },
  )
  expect(document.querySelector('[data-gantt-stages] [data-done]')).toBeTruthy()
})

test('an open tracker task has a dimmed box that cannot be ticked', () => {
  renderGantt({}, content, OFF, { 'DEMO-1': { ...task, status_category: 'new' } })
  const box = screen.getByRole('checkbox', { name: 'Mark done: DEMO-1' })
  expect(box.hasAttribute('disabled')).toBe(true)
  expect(box.className).toContain('disabled:not-data-checked:opacity-40')
  fireEvent.click(box)
  expect('done' in rows()[0]).toBe(false)
  expect(screen.getByText('Rotate the staging certificates').className).not.toContain(
    'line-through',
  )
})

test('a done tracker task is ticked and struck through like any done row', () => {
  renderGantt()
  expect(
    screen.getByRole('checkbox', { name: 'Mark not done: DEMO-1' }).getAttribute('data-state'),
  ).toBe('checked')
  expect(screen.getByText('Rotate the staging certificates').className).toContain('line-through')
})

const twoStages: GanttContent = {
  ...content,
  rows: [
    {
      id: 'a',
      title: 'Payment API',
      start: '2026-10-05',
      end: '2026-10-16',
      stages: [
        { id: 's1', type: 't1', start: '2026-10-05', end: '2026-10-07', people: [] },
        { id: 's2', type: 't3', start: '2026-10-12', end: '2026-10-16', people: [] },
      ],
    },
  ],
}

test('stages are ticked one by one; the row is done when all are', () => {
  renderGantt({}, twoStages, PLANNING)
  press(screen.getByRole('button', { name: 'Discovery stage of Payment API' }), 300)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Done' }))
  expect(rows()[0].stages![0].done).toBe(true)
  expect(rows()[0].done).toBeUndefined()
  expect(
    screen.getByRole('button', { name: 'Discovery stage of Payment API' }).className,
  ).toContain('done-hatch')
  expect(
    screen.getByRole('button', { name: 'Build stage of Payment API' }).className,
  ).not.toContain('done-hatch')

  press(screen.getByRole('button', { name: 'Build stage of Payment API' }), 500)
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'Done' }).at(-1)!)
  expect(rows()[0].done).toBe(true)

  // The row's own box unticks every stage at once.
  fireEvent.click(screen.getByRole('checkbox', { name: 'Mark not done: Payment API' }))
  expect(rows()[0].stages!.some((s) => s.done)).toBe(false)
  expect(rows()[0].done).toBeUndefined()
})

test('a done stage raises no time off warning', () => {
  const away: PlanningState = {
    ...PLANNING,
    people: [
      {
        id: 'p1',
        name: 'Anna',
        teams: [],
        source: 'manual',
        archived: false,
        off: [{ id: 'o1', start: '2026-10-05', end: '2026-10-09' }],
      },
    ],
  }
  const staffed = (done: boolean): GanttContent => ({
    ...twoStages,
    rows: [
      {
        ...twoStages.rows[0],
        stages: [
          { ...twoStages.rows[0].stages![0], people: ['p1'], ...(done && { done: true }) },
          twoStages.rows[0].stages![1],
        ],
      },
    ],
  })
  renderGantt({}, staffed(false), away)
  expect(screen.getByLabelText('Someone is away')).toBeTruthy()
  document.body.innerHTML = ''
  renderGantt({}, staffed(true), away)
  expect(screen.queryByLabelText('Someone is away')).toBeNull()
})

// Rows start 200px down the screen; the module covers 1200 by 800 from the top left.
const ROWS_TOP = 200
function placeOnScreen() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const box = (left: number, top: number, width: number, height: number) =>
      ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
      }) as DOMRect
    if (this.matches('.react-flow__node')) return box(0, 0, 1200, 800)
    if (this.matches('[data-gantt-rows]')) return box(0, ROWS_TOP, 160, 400)
    return box(0, 0, 0, 0)
  })
}

type PlanRow = GanttContent['rows'][number]
const plain = (id: string, parent?: string, extra: Partial<PlanRow> = {}): PlanRow => ({
  id,
  title: `Row ${id}`,
  start: '2026-10-05',
  end: '2026-10-09',
  ...(parent && { parent }),
  ...extra,
})
const plan = (list: PlanRow[]): GanttContent => ({ ...content, rows: list })
// The title in the task column, not the bar's label or the ghost.
const label = (id: string) =>
  screen.getAllByText(`Row ${id}`).find((el) => el.closest('.group\\/label'))!
const shiftOf = (id: string) => (label(id).closest('[data-shift]') as HTMLElement).style
// The middle of the row at index `i` on screen.
const rowY = (i: number) => ROWS_TOP + i * 34 + 17

function pressRow(id: string, i: number, keys: { metaKey?: boolean; shiftKey?: boolean } = {}) {
  fireEvent.pointerDown(label(id), {
    clientX: 50,
    clientY: rowY(i),
    pointerId: 1,
    button: 0,
    // A primary pointer, which the board's Shift selection box would take for its own.
    isPrimary: true,
    ...keys,
  })
}
const moveTo = (x: number, y: number) =>
  fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerId: 1 })
const release = (x: number, y: number, keys: { metaKey?: boolean; shiftKey?: boolean } = {}) =>
  fireEvent.pointerUp(window, { clientX: x, clientY: y, pointerId: 1, ...keys })

test('a dragged row opens a gap where it will land, and lands there', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c'), plain('d')]))
  pressRow('a', 0)
  moveTo(50, rowY(2))
  // a is lifted out, b and c close up, the gap opens before d.
  expect(shiftOf('a').visibility).toBe('hidden')
  expect(shiftOf('b').transform).toBe('translateY(-34px)')
  expect(shiftOf('c').transform).toBe('translateY(-34px)')
  expect(shiftOf('d').transform).toBe('')
  // The timeline part of the row moves with its label.
  const bar = document.querySelector('[data-gantt-row="b"]')!.closest('[data-shift]') as HTMLElement
  expect(bar.style.transform).toBe('translateY(-34px)')
  const place = screen.getByTestId('gantt-drop-place')
  expect(place.style.top).toBe(`${2 * 34 + 2}px`)
  expect(place.getAttribute('data-depth')).toBe('0')
  release(50, rowY(2))
  expect(rows().map((r) => r.id)).toEqual(['b', 'c', 'a', 'd'])
  expect(screen.queryByTestId('gantt-drop-place')).toBeNull()
  screenBox.mockRestore()
})

test('a row dragged sideways shows and takes the level it will nest at', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c')]))
  pressRow('c', 2)
  moveTo(50 + 16, rowY(2))
  const place = screen.getByTestId('gantt-drop-place')
  expect(place.getAttribute('data-depth')).toBe('1')
  // b will be its parent: it gets the bar.
  expect((label('b').closest('[data-shift]') as HTMLElement).className).toContain(
    'before:bg-primary',
  )
  release(50 + 16, rowY(2))
  expect(rows().map((r) => [r.id, r.parent])).toEqual([
    ['a', undefined],
    ['b', undefined],
    ['c', 'b'],
  ])
  screenBox.mockRestore()
})

test('a dragged parent lifts its children, and the distance counts what is on screen', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('p'), plain('c1', 'p'), plain('c2', 'p'), plain('x'), plain('y')]))
  pressRow('p', 0)
  moveTo(50, rowY(0) + 10)
  // The whole branch rides in the ghost.
  expect(within(screen.getByTestId('gantt-drag-ghost')).getAllByText(/Row /)).toHaveLength(3)
  expect(shiftOf('c1').visibility).toBe('hidden')
  expect(shiftOf('x').transform).toBe('')
  // One row down on screen: x closes up under the ghost, and the branch lands past it.
  moveTo(50, rowY(1))
  expect(shiftOf('x').transform).toBe('translateY(-102px)')
  release(50, rowY(1))
  expect(rows().map((r) => r.id)).toEqual(['x', 'p', 'c1', 'c2', 'y'])
  screenBox.mockRestore()
})

test('a row dropped into a collapsed row opens it and stays in view', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a', undefined, { collapsed: true }), plain('a1', 'a'), plain('b')]))
  pressRow('b', 1)
  moveTo(50 + 16, rowY(1))
  release(50 + 16, rowY(1))
  expect(rows().map((r) => [r.id, r.parent])).toEqual([
    ['a', undefined],
    ['a1', 'a'],
    ['b', 'a'],
  ])
  expect(rows()[0].collapsed).toBe(false)
  expect(label('b')).toBeTruthy()
  screenBox.mockRestore()
})

test('the level is clamped to five in all, and a place with no level says so', () => {
  const screenBox = placeOnScreen()
  const deep = plan([
    plain('1'),
    plain('2', '1'),
    plain('3', '2'),
    plain('4', '3'),
    plain('5'),
    plain('6', '5'),
  ])
  renderGantt({}, deep)
  pressRow('5', 4)
  moveTo(50 + 999, rowY(4))
  // Under 4 at most level 3: its child 6 is then the fifth level.
  expect(screen.getByTestId('gantt-drop-place').getAttribute('data-depth')).toBe('3')
  release(50 + 999, rowY(4))
  expect(rows().map((r) => r.parent)).toEqual([undefined, '1', '2', '3', '3', '5'])
  screenBox.mockRestore()
})

test('Esc ends a drag with nothing written, before the expanded view or the board hears it', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c')]))
  const before = current()
  const heard = vi.fn()
  document.addEventListener('keydown', heard, true)
  pressRow('a', 0)
  moveTo(50, rowY(2))
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(heard).not.toHaveBeenCalled()
  expect(shiftOf('b').transform).toBe('')
  release(50, rowY(2))
  expect(current()).toBe(before)
  // With no drag Esc goes on as before.
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(heard).toHaveBeenCalledTimes(1)
  document.removeEventListener('keydown', heard, true)
  screenBox.mockRestore()
})

test('a row dragged out of the module says it goes to the board', () => {
  const screenBox = placeOnScreen()
  const host = renderGantt({}, plan([plain('a'), plain('b')]))
  pressRow('a', 0)
  moveTo(1500, 900)
  expect(screen.getByText('Drop on the board')).toBeTruthy()
  expect(screen.queryByTestId('gantt-drop-place')).toBeNull()
  release(1500, 900)
  expect(host.ejectNote).toHaveBeenCalledWith('Row a', { x: 1500, y: 900 })
  expect(rows().map((r) => r.id)).toEqual(['b'])
  screenBox.mockRestore()
})

const picked = () =>
  [...document.querySelectorAll('[data-gantt-rows] [data-selected]')].map((el) =>
    el.getAttribute('data-shift'),
  )
function clickRow(id: string, i: number, keys: { metaKey?: boolean; shiftKey?: boolean } = {}) {
  pressRow(id, i, keys)
  release(50, rowY(i), keys)
}
// The row's own background, right of its title: a drag there draws a lasso, a click picks the row.
const blank = (id: string) => label(id).closest('.group\\/label') as HTMLElement

test('rows are selected by click, Cmd-click and Shift-click, in every part of the row', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c'), plain('d'), plain('e')]))
  clickRow('b', 1)
  expect(picked()).toEqual(['b'])
  clickRow('d', 3, { shiftKey: true })
  expect(picked()).toEqual(['b', 'c', 'd'])
  clickRow('c', 2, { metaKey: true })
  expect(picked()).toEqual(['b', 'd'])
  clickRow('e', 4)
  expect(picked()).toEqual(['e'])
  // The board does not read a Shift-click on a row as one that drops the Gantt from its selection.
  fireEvent.keyDown(document, { key: 'Shift' })
  clickRow('d', 3, { shiftKey: true })
  fireEvent.click(label('d'), { shiftKey: true })
  fireEvent.keyUp(document, { key: 'Shift' })
  expect(latest[0].selected).toBe(true)
  expect(picked()).toEqual(['d', 'e'])
  clickRow('e', 4)
  // The timeline part of the row is tinted too.
  const bar = document.querySelector('[data-gantt-row="e"]')!.closest('[data-shift]')!
  expect(bar.getAttribute('data-selected')).toBe('true')
  expect(bar.className).toContain('bg-primary/10')
  // Esc clears it and goes no further.
  const heard = vi.fn()
  document.addEventListener('keydown', heard, true)
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(picked()).toEqual([])
  expect(heard).not.toHaveBeenCalled()
  document.removeEventListener('keydown', heard, true)
  screenBox.mockRestore()
})

test('a lasso from blank space selects the rows it touches and never reaches the board', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c'), plain('d')]))
  const board = vi.fn()
  document.body.addEventListener('pointerdown', board)
  fireEvent.pointerDown(blank('b'), { clientX: 150, clientY: rowY(1), pointerId: 1, button: 0 })
  expect(board).not.toHaveBeenCalled()
  moveTo(150, rowY(2) + 4)
  expect(screen.getByTestId('gantt-lasso')).toBeTruthy()
  expect(picked()).toEqual(['b', 'c'])
  release(150, rowY(2) + 4)
  expect(screen.queryByTestId('gantt-lasso')).toBeNull()
  expect(picked()).toEqual(['b', 'c'])
  // With Shift a second lasso adds to it.
  fireEvent.pointerDown(blank('d'), {
    clientX: 150,
    clientY: rowY(3),
    pointerId: 1,
    button: 0,
    shiftKey: true,
  })
  moveTo(150, rowY(3) + 8)
  release(150, rowY(3) + 8)
  expect(picked()).toEqual(['b', 'c', 'd'])
  // A click on a row's blank space picks that row, as a click on its title does.
  fireEvent.pointerDown(blank('a'), { clientX: 150, clientY: rowY(0), pointerId: 1, button: 0 })
  release(150, rowY(0))
  expect(picked()).toEqual(['a'])
  fireEvent.pointerDown(blank('c'), {
    clientX: 150,
    clientY: rowY(2),
    pointerId: 1,
    button: 0,
    metaKey: true,
  })
  release(150, rowY(2), { metaKey: true })
  expect(picked()).toEqual(['a', 'c'])
  // A click on the band under the rows clears the selection.
  const column = document.querySelector('[data-gantt-rows]')!.parentElement!
  fireEvent.pointerDown(column, { clientX: 150, clientY: rowY(4) + 10, pointerId: 1, button: 0 })
  release(150, rowY(4) + 10)
  expect(picked()).toEqual([])
  document.body.removeEventListener('pointerdown', board)
  screenBox.mockRestore()
})

test('a selection moves as one: branches in plan order, siblings at the shown level', () => {
  const screenBox = placeOnScreen()
  // p with children p1 and p2, then q, r with child r1, then s.
  renderGantt(
    {},
    plan([
      plain('p'),
      plain('p1', 'p'),
      plain('p2', 'p'),
      plain('q'),
      plain('r'),
      plain('r1', 'r'),
      plain('s'),
    ]),
  )
  // p with its own child p2, and r1 without its parent: a gap and two levels.
  clickRow('p', 0)
  clickRow('p2', 2, { metaKey: true })
  clickRow('r1', 5, { metaKey: true })
  pressRow('p', 0)
  // Down to the end, past s.
  moveTo(50, rowY(4) + 20)
  expect(within(screen.getByTestId('gantt-drag-ghost')).getAllByText(/Row /)).toHaveLength(4)
  release(50, rowY(4) + 20)
  expect(rows().map((r) => [r.id, r.parent])).toEqual([
    ['q', undefined],
    ['r', undefined],
    ['s', undefined],
    ['p', undefined],
    ['p1', 'p'],
    ['p2', 'p'],
    ['r1', undefined],
  ])
  // The moved rows stay selected.
  expect(picked()).toEqual(['p', 'p2', 'r1'])
  screenBox.mockRestore()
})

test('a drag from a row outside the selection moves that row alone', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c'), plain('d')]))
  clickRow('a', 0)
  pressRow('c', 2)
  moveTo(50, rowY(3) + 4)
  release(50, rowY(3) + 4)
  expect(rows().map((r) => r.id)).toEqual(['a', 'b', 'd', 'c'])
  expect(picked()).toEqual(['c'])
  screenBox.mockRestore()
})

test('Delete removes the selected rows and never the Gantt', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b', 'a'), plain('c')]))
  clickRow('a', 0)
  clickRow('c', 2, { metaKey: true })
  const heard = vi.fn()
  document.addEventListener('keydown', heard, true)
  fireEvent.keyDown(document.body, { key: 'Backspace' })
  expect(heard).not.toHaveBeenCalled()
  // a's child stays, one level up; the module is still on the board.
  expect(rows().map((r) => [r.id, r.parent])).toEqual([['b', undefined]])
  expect(latest).toHaveLength(1)
  // With nothing selected Backspace goes on to the board as before.
  fireEvent.keyDown(document.body, { key: 'Backspace' })
  expect(heard).toHaveBeenCalledTimes(1)
  document.removeEventListener('keydown', heard, true)
  screenBox.mockRestore()
})

test('a selection dropped on the board becomes cards and notes in a column', () => {
  const screenBox = placeOnScreen()
  const host = renderGantt(
    {},
    plan([{ ...plain('a'), key: 'DEMO-1', title: '' }, plain('b'), plain('c')]),
  )
  clickRow('b', 1)
  clickRow('c', 2, { metaKey: true })
  pressRow('b', 1)
  moveTo(1500, 900)
  expect(screen.getByText('2 rows to the board')).toBeTruthy()
  release(1500, 900)
  expect(host.ejectNote).toHaveBeenNthCalledWith(1, 'Row b', { x: 1500, y: 900 })
  expect(host.ejectNote).toHaveBeenNthCalledWith(2, 'Row c', { x: 1500, y: 1116 })
  expect(rows().map((r) => r.id)).toEqual(['a'])
  screenBox.mockRestore()
})

test('a parent dragged out to the board takes its branch along', () => {
  const screenBox = placeOnScreen()
  const host = renderGantt(
    {},
    plan([plain('a'), { ...plain('b'), parent: 'a' }, { ...plain('c'), parent: 'b' }, plain('d')]),
  )
  pressRow('a', 0)
  moveTo(1500, 900)
  expect(screen.getByText('3 rows to the board')).toBeTruthy()
  release(1500, 900)
  for (const [i, text] of ['Row a', 'Row b', 'Row c'].entries())
    expect(host.ejectNote).toHaveBeenNthCalledWith(i + 1, text, expect.anything())
  expect(host.ejectNote).toHaveBeenCalledTimes(3)
  expect(rows().map((r) => r.id)).toEqual(['d'])
  screenBox.mockRestore()
})

test('selected rows are options in a list of rows', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b')]))
  clickRow('b', 1)
  const list = screen.getByRole('listbox', { name: 'Rows' })
  expect(list.getAttribute('aria-multiselectable')).toBe('true')
  const options = within(list).getAllByRole('option')
  expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true'])
  // A row button gives focus back once clicked: the board ignores keys while focus is in the list.
  const indent = screen.getByRole('button', { name: 'Indent Row b' })
  indent.focus()
  fireEvent.click(indent)
  expect(document.activeElement).not.toBe(indent)
  screenBox.mockRestore()
})

test('Delete and Esc are left alone while typing in a field or working in a popover', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b')]))
  clickRow('a', 0)
  const heard = vi.fn()
  document.addEventListener('keydown', heard, true)
  const field = document.createElement('input')
  const popover = document.createElement('div')
  popover.innerHTML = '<button type="button">Pick</button>'
  document.body.append(field, popover)
  field.focus()
  fireEvent.keyDown(field, { key: 'Backspace' })
  popover.querySelector('button')!.focus()
  fireEvent.keyDown(popover.querySelector('button')!, { key: 'Backspace' })
  fireEvent.keyDown(popover.querySelector('button')!, { key: 'Escape' })
  expect(heard).toHaveBeenCalledTimes(3)
  expect(rows().map((r) => r.id)).toEqual(['a', 'b'])
  expect(picked()).toEqual(['a'])
  field.remove()
  popover.remove()
  document.removeEventListener('keydown', heard, true)
  screenBox.mockRestore()
})

// Regression: ISSUE-001 — Esc in the filter popover dropped the Gantt from the board's selection
// and its rows with it; an arrow key there moved the Gantt.
// Found by /qa on 2026-11-21
// Report: .gstack/qa-reports/qa-report-localhost-3391-2026-11-21.md
test('keys in a filter popover leave the Gantt selected and in place', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b')]), VIEWS)
  clickRow('a', 0)
  const start = latest[0].position
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
  const field = screen.getByRole('button', { name: 'Quarter' })
  fireEvent.keyDown(field, { key: 'ArrowDown' })
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(latest[0].selected).toBe(true)
  expect(latest[0].position).toEqual(start)
  expect(picked()).toEqual(['a'])
  screenBox.mockRestore()
})

test('an open expanded view keeps the keys from the Gantt behind it', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b')]))
  clickRow('a', 0)
  const view = document.createElement('div')
  view.setAttribute('data-module-expanded', '')
  view.tabIndex = -1
  document.body.append(view)
  view.focus()
  const heard = vi.fn()
  document.addEventListener('keydown', heard, true)
  fireEvent.keyDown(view, { key: 'Backspace' })
  fireEvent.keyDown(view, { key: 'Escape' })
  // The view hears both, so its first Esc closes it; the board's copy changes nothing.
  expect(heard).toHaveBeenCalledTimes(2)
  expect(rows().map((r) => r.id)).toEqual(['a', 'b'])
  view.remove()
  document.removeEventListener('keydown', heard, true)
  screenBox.mockRestore()
})

test('the selection ends when the Gantt is no longer selected on the board', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b')]))
  clickRow('a', 0)
  expect(picked()).toEqual(['a'])
  fireEvent.click(document.querySelector('.react-flow__pane')!)
  expect(latest[0].selected).toBeFalsy()
  expect(picked()).toEqual([])
  screenBox.mockRestore()
})

test('one selection on the board: picking rows in another Gantt ends the first', () => {
  const screenBox = placeOnScreen()
  second = plan([plain('m'), plain('n')])
  try {
    renderGantt({}, plan([plain('a'), plain('b')]))
    clickRow('a', 0)
    // A Cmd-click in the other Gantt, which the board has not selected yet.
    pressRow('m', 0, { metaKey: true })
    release(50, rowY(0), { metaKey: true })
    fireEvent.click(label('m'), { metaKey: true })
    expect(picked()).toEqual(['m'])
    expect(latest.find((n) => n.id === 'h')!.selected).toBe(true)
    fireEvent.keyDown(document.body, { key: 'Backspace' })
    const contentOf = (id: string) =>
      (latest.find((n) => n.id === id)!.data as { content: GanttContent }).content
    expect(contentOf('g').rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(contentOf('h').rows.map((r) => r.id)).toEqual(['n'])
  } finally {
    second = null
    screenBox.mockRestore()
  }
})

test('a cancelled pointer or a window losing focus puts the dragged rows back', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c')]))
  const before = current()
  pressRow('a', 0)
  moveTo(50, rowY(2))
  expect(shiftOf('b').transform).toBe('translateY(-34px)')
  fireEvent.pointerCancel(window, { pointerId: 1 })
  expect(shiftOf('b').transform).toBe('')
  release(50, rowY(2))
  pressRow('a', 0)
  moveTo(50, rowY(2))
  fireEvent.blur(window)
  expect(shiftOf('b').transform).toBe('')
  release(50, rowY(2))
  expect(current()).toBe(before)
  screenBox.mockRestore()
})

test('a dragged row someone else deletes ends the drag cleanly', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c')]))
  pressRow('b', 1)
  moveTo(50, rowY(2) + 4)
  expect(screen.getByTestId('gantt-drag-ghost')).toBeTruthy()
  act(() => remote('g', plan([plain('a'), plain('c')])))
  expect(screen.queryByTestId('gantt-drag-ghost')).toBeNull()
  release(50, rowY(2) + 4)
  expect(rows().map((r) => r.id)).toEqual(['a', 'c'])
  screenBox.mockRestore()
})

test('a drop lands after the ghost glides, on the plan as it is then', async () => {
  const screenBox = placeOnScreen()
  let finish = () => {}
  const animate = vi.fn(() => ({
    finished: new Promise<void>((resolve) => (finish = resolve)),
    cancel: () => {},
  }))
  Element.prototype.animate = animate as unknown as Element['animate']
  try {
    renderGantt({}, plan([plain('a'), plain('b'), plain('c'), plain('d')]))
    pressRow('a', 0)
    moveTo(50, rowY(2))
    release(50, rowY(2))
    expect(animate).toHaveBeenCalledTimes(1)
    // Nothing is written while the ghost glides; someone renames d meanwhile.
    expect(rows().map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
    const renamed = plan([plain('a'), plain('b'), plain('c'), { ...plain('d'), title: 'Renamed' }])
    act(() => remote('g', renamed))
    await act(async () => finish())
    expect(rows().map((r) => r.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(rows()[3].title).toBe('Renamed')
  } finally {
    delete (Element.prototype as { animate?: unknown }).animate
    screenBox.mockRestore()
  }
})

test('a Shift-lasso from the band under the rows adds rows, not a board selection box', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c')]))
  clickRow('a', 0)
  const column = document.querySelector('[data-gantt-rows]')!.parentElement!
  expect(column.className).toContain('nokey')
  // The board's Shift box would take this primary press; nokey keeps it in the Gantt.
  fireEvent.keyDown(document, { key: 'Shift' })
  fireEvent.pointerDown(column, {
    clientX: 150,
    clientY: rowY(3) + 10,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    shiftKey: true,
  })
  moveTo(150, rowY(1))
  release(150, rowY(1), { shiftKey: true })
  fireEvent.keyUp(document, { key: 'Shift' })
  expect(picked()).toEqual(['a', 'b', 'c'])
  screenBox.mockRestore()
})

test('rows folded away leave the selection and do not come back with the fold', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b', 'a'), plain('c')]))
  clickRow('b', 1)
  expect(picked()).toEqual(['b'])
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Row a' }))
  fireEvent.click(screen.getByRole('button', { name: 'Expand Row a' }))
  expect(picked()).toEqual([])
  fireEvent.keyDown(document.body, { key: 'Backspace' })
  expect(rows().map((r) => r.id)).toEqual(['a', 'b', 'c'])
  // The anchor went with it: a Shift-click starts afresh.
  clickRow('c', 2, { shiftKey: true })
  expect(picked()).toEqual(['c'])
  screenBox.mockRestore()
})

test('a row someone else adds mid-drag gets its place in the moved-aside rows', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c'), plain('d')]))
  pressRow('d', 3)
  moveTo(50, rowY(0))
  expect(shiftOf('c').transform).toBe('translateY(34px)')
  act(() => remote('g', plan([plain('a'), plain('b'), plain('x'), plain('c'), plain('d')])))
  // The gap is still at the top; a, b, x and c all sit one row down, x over nobody.
  expect(shiftOf('x').transform).toBe('translateY(34px)')
  expect(shiftOf('c').transform).toBe('translateY(34px)')
  release(50, rowY(0))
  expect(rows().map((r) => r.id)).toEqual(['d', 'a', 'b', 'x', 'c'])
  screenBox.mockRestore()
})

test('a drop place folded away by someone else while the ghost glides keeps the rows put', async () => {
  const screenBox = placeOnScreen()
  let finish = () => {}
  Element.prototype.animate = vi.fn(() => ({
    finished: new Promise<void>((resolve) => (finish = resolve)),
    cancel: () => {},
  })) as unknown as Element['animate']
  try {
    // p holds a; x goes under a as its child.
    renderGantt({}, plan([plain('p'), plain('a', 'p'), plain('x')]))
    pressRow('x', 2)
    moveTo(50 + 16, rowY(2))
    release(50 + 16, rowY(2))
    const folded = plan([plain('p', undefined, { collapsed: true }), plain('a', 'p'), plain('x')])
    act(() => remote('g', folded))
    await act(async () => finish())
    expect(rows().map((r) => [r.id, r.parent])).toEqual([
      ['p', undefined],
      ['a', 'p'],
      ['x', undefined],
    ])
    expect(screen.queryByTestId('gantt-drag-ghost')).toBeNull()
  } finally {
    delete (Element.prototype as { animate?: unknown }).animate
    screenBox.mockRestore()
  }
})

test('a lifted row someone else deletes keeps the pressed row under the pointer', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c'), plain('d')]))
  clickRow('a', 0)
  clickRow('b', 1, { metaKey: true })
  pressRow('b', 1)
  moveTo(50, rowY(1) + 6)
  act(() => remote('g', plan([plain('b'), plain('c'), plain('d')])))
  // b is now the only lifted row: the ghost's top is b's own top, so it lands past d.
  moveTo(50, rowY(2) + 4)
  release(50, rowY(2) + 4)
  expect(rows().map((r) => r.id)).toEqual(['c', 'd', 'b'])
  screenBox.mockRestore()
})

test('a drag ends when someone else removes the pressed row', () => {
  const screenBox = placeOnScreen()
  renderGantt({}, plan([plain('a'), plain('b'), plain('c')]))
  clickRow('a', 0)
  clickRow('b', 1, { metaKey: true })
  pressRow('b', 1)
  moveTo(50, rowY(2))
  act(() => remote('g', plan([plain('a'), plain('c')])))
  expect(screen.queryByTestId('gantt-drag-ghost')).toBeNull()
  release(50, rowY(2))
  expect(rows().map((r) => r.id)).toEqual(['a', 'c'])
  screenBox.mockRestore()
})
