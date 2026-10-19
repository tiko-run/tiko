import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { isJql, Toolbar } from '@/canvas/Toolbar'

const task = {
  source: 'demo',
  key: 'DEMO-1',
  state: 'ok',
  summary: 'Rotate the staging certificates',
  status_name: 'To Do',
  status_category: 'new',
  type_name: 'Task',
  assignee_name: null,
  priority_name: null,
  updated: null,
  url: 'https://jira.example.com/browse/DEMO-1',
  fetched_at: '2026-10-05T07:00:00Z',
}

afterEach(() => vi.unstubAllGlobals())

function renderToolbar(
  onAddCards = vi.fn(),
  onTool = vi.fn(),
  onAddModule = vi.fn(),
  onShape = vi.fn(),
) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Toolbar
        tool="select"
        onTool={onTool}
        onShape={onShape}
        onAddCards={onAddCards}
        onAddModule={onAddModule}
      />
    </QueryClientProvider>,
  )
  return onAddCards
}

test('has no card input until the task card tool is picked', () => {
  renderToolbar()
  expect(screen.queryByLabelText('Issue keys, links or JQL')).toBeNull()
})

test('adds a card from the popover and closes it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ task }), { status: 200 })),
  )
  const onAddCards = renderToolbar()
  fireEvent.click(screen.getByRole('button', { name: 'Task card' }))
  const field = await screen.findByLabelText('Issue keys, links or JQL')
  fireEvent.change(field, { target: { value: 'DEMO-1' } })
  fireEvent.submit(field)

  await waitFor(() => expect(onAddCards).toHaveBeenCalledWith([task]))
  await waitFor(() => expect(screen.queryByLabelText('Issue keys, links or JQL')).toBeNull())
})

test('closes the popover on Escape', async () => {
  renderToolbar()
  fireEvent.click(screen.getByRole('button', { name: 'Task card' }))
  const field = await screen.findByLabelText('Issue keys, links or JQL')
  fireEvent.keyDown(field, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByLabelText('Issue keys, links or JQL')).toBeNull())
})

test('adds several cards at once and keeps the ones that failed in the field', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const { ref } = JSON.parse(init.body as string)
      if (ref === 'NOPE') {
        return new Response(
          JSON.stringify({ error: { code: 'invalid_ref', message: 'Not a Jira key or link' } }),
          { status: 422 },
        )
      }
      return new Response(JSON.stringify({ task: { ...task, key: ref } }), { status: 200 })
    }),
  )
  const onAddCards = renderToolbar()
  fireEvent.click(screen.getByRole('button', { name: 'Task card' }))
  const field = await screen.findByLabelText('Issue keys, links or JQL')
  fireEvent.change(field, { target: { value: 'DEMO-1, DEMO-2,NOPE DEMO-1' } })
  fireEvent.submit(field)

  await waitFor(() => expect(onAddCards).toHaveBeenCalledWith([task, { ...task, key: 'DEMO-2' }]))
  expect(await screen.findByRole('alert')).toHaveTextContent('NOPE:')
  expect(screen.getByLabelText('Issue keys, links or JQL')).toHaveValue('NOPE')
})

test('tells a JQL query from keys and links', () => {
  expect(isJql('DEMO-1, DEMO-2')).toBe(false)
  expect(isJql('https://jira.example.com/browse/DEMO-1')).toBe(false)
  expect(isJql('NOPE')).toBe(false)
  expect(isJql('project = DEV AND status != Done')).toBe(true)
  expect(isJql('key in (DEMO-1, DEMO-2)')).toBe(true)
})

test('adds the tasks a JQL query finds and keeps the form open when some are left', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ tasks: [task], total: 3 }), {
        status: 200,
      }),
  )
  vi.stubGlobal('fetch', fetch)
  const onAddCards = renderToolbar()
  fireEvent.click(screen.getByRole('button', { name: 'Task card' }))
  const field = await screen.findByLabelText('Issue keys, links or JQL')
  fireEvent.change(field, { target: { value: 'project = DEMO' } })
  fireEvent.submit(field)

  await waitFor(() => expect(onAddCards).toHaveBeenCalledWith([task]))
  expect(fetch).toHaveBeenCalledWith('/api/tasks/search', expect.anything())
  expect(await screen.findByRole('alert')).toHaveTextContent('Added 1 of 3.')
})

test('says about for a count the tracker only estimates', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ tasks: [task], total: 140, estimated: true }), {
        status: 200,
      }),
  )
  vi.stubGlobal('fetch', fetch)
  renderToolbar()
  fireEvent.click(screen.getByRole('button', { name: 'Task card' }))
  const field = await screen.findByLabelText('Issue keys, links or JQL')
  fireEvent.change(field, { target: { value: 'project = DEMO' } })
  expect(await screen.findByText('About 140 tasks match, the first 50 are added.')).toBeTruthy()
  fireEvent.submit(field)
  expect(await screen.findByRole('alert')).toHaveTextContent('Added 1 of about 140.')
})

test('links to what each tracker takes instead of listing it', async () => {
  renderToolbar()
  fireEvent.click(screen.getByRole('button', { name: 'Task card' }))
  const link = await screen.findByRole('link', { name: 'What you can add' })
  expect(link).toHaveAttribute('href', 'https://docs.tiko.run/what-you-can-add/')
})

test('picks tools from the keyboard', () => {
  const onTool = vi.fn()
  renderToolbar(vi.fn(), onTool)
  fireEvent.keyDown(document, { key: 'f', code: 'KeyF' })
  expect(onTool).toHaveBeenCalledWith('frame')
  expect(screen.getByRole('button', { name: 'Frame' })).toHaveAttribute('title', 'Frame (F)')
})

test('adds a module picked from the gallery', async () => {
  const onAddModule = vi.fn()
  renderToolbar(vi.fn(), vi.fn(), onAddModule)
  fireEvent.click(screen.getByRole('button', { name: 'Modules' }))
  fireEvent.click(await screen.findByRole('button', { name: /Gantt/ }))
  expect(onAddModule).toHaveBeenCalledWith('gantt')
  await waitFor(() => expect(screen.queryByRole('button', { name: /Gantt/ })).toBeNull())
})

test('picks a shape from the gallery and closes it', async () => {
  const onShape = vi.fn()
  renderToolbar(vi.fn(), vi.fn(), vi.fn(), onShape)
  fireEvent.keyDown(document, { key: 's', code: 'KeyS' })
  const rhombus = await screen.findByRole('button', { name: 'Rhombus' })
  expect(screen.getByRole('button', { name: 'Rectangle' })).not.toHaveFocus()
  fireEvent.click(rhombus)
  expect(onShape).toHaveBeenCalledWith('rhombus')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Rhombus' })).toBeNull())
})
