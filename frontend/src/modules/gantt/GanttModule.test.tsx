import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Node } from '@xyflow/react'
import { useLayoutEffect } from 'react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { Task } from '@/api/tasks'
import { moduleControls } from '@/canvas/module-controls'
import { ModuleNode } from '@/canvas/nodes/ModuleNode'
import { TasksContext } from '@/canvas/tasks-context'
import type { AppNode, ModuleNode as ModuleNodeType } from '@/canvas/types'
import { ModuleHostContext } from '@/modules/host-context'
import type { GanttContent } from '@/modules/gantt/schema'
import type { ModuleHost } from '@/modules/types'
import { PlanningContext, type PlanningState } from '@/planning/context'

const nodeTypes = { module: ModuleNode }

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
  ])
  const { updateNodeData } = useReactFlow()
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
      <ReactFlow nodes={nodes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} />
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
) {
  const full: ModuleHost = { addTasks: vi.fn(), ejectCard: vi.fn(), ejectNote: vi.fn(), ...host }
  render(
    <div style={{ width: 1200, height: 800 }}>
      <QueryClientProvider client={new QueryClient()}>
        <ReactFlowProvider>
          <TasksContext.Provider value={tasks}>
            <ModuleHostContext.Provider value={full}>
              <PlanningContext.Provider value={planning}>
                <Board start={start} />
              </PlanningContext.Provider>
            </ModuleHostContext.Provider>
          </TasksContext.Provider>
        </ReactFlowProvider>
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
  press(screen.getByRole('slider', { name: 'No stage stage of Design review' }), 400)
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
  press(screen.getByRole('slider', { name: 'Build stage of Payment API' }), 500, 0)
  expect(rows()[0].stages![1]).toMatchObject({ start: '2026-10-08', end: '2026-10-12' })
  expect(rows()[0].end).toBe('2026-10-12')
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
  const bars = screen.getAllByRole('slider', { name: /stage of Payment API/ })
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
  const bar = screen.getByRole('slider', { name: 'Build stage of Payment API' })
  expect(bar.textContent).toBe('Build · Ivan, Anna')
  expect(within(bar).getByText('Anna').className).toContain('opacity-60')
  expect(within(bar).getByText('Ivan').className).not.toContain('opacity-60')
})

test('names below the bars make the rows taller', () => {
  renderGantt({}, staged(['p1'], { people: 'below' }), PEOPLE)
  const bar = screen.getByRole('slider', { name: 'Build stage of Payment API' })
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
  press(screen.getByRole('slider', { name: 'Build stage of Payment API' }), 500)
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
    press(screen.getByRole('slider', { name: 'Build stage of Payment API' }), 500)
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
    const bar = screen.getByRole('slider', { name: 'Build stage of Payment API' })
    expect(bar.textContent).toBe('Build2')
    const count = within(bar).getByRole('button', { name: '2 people on Build' })
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
  const bar = screen.getByRole('slider', { name: 'Build stage of Payment API' })
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
    press(screen.getByRole('slider', { name: 'Build stage of Payment API' }), 500)
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
  const bar = screen.getByRole('slider', { name: 'Build stage of Payment API' })
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
  const bar = screen.getByRole('slider', { name: 'Build stage of Payment API' })
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
  const stage = screen.getByRole('slider', { name: 'Build stage of Payment API' })
  expect(stage.getAttribute('aria-valuetext')).toBe('Mon Oct 12 – Fri Oct 16 · 4 days')
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
