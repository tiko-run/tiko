import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PrefixDialog } from '@/canvas/PrefixDialog'
import { resolveAll, type Resolved } from '@/canvas/refs'

afterEach(() => vi.unstubAllGlobals())

function task(source: string, key: string) {
  return {
    source,
    key,
    state: 'ok',
    summary: `Task ${key}`,
    status_name: 'To Do',
    status_category: 'new',
    type_name: 'Issue',
    assignee_name: null,
    priority_name: null,
    updated: null,
    url: 'https://tracker.example.com',
    fetched_at: '2026-11-26T07:00:00Z',
  }
}

/** CORE is known to Jira and Linear; any other prefix resolves at once. */
function stubTrackers() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { ref?: string; source?: string }
    if (url.startsWith('/api/me/key-prefixes/')) {
      return Response.json({ choices: [{ prefix: 'CORE', source: body.source }] })
    }
    const ref = body.ref ?? ''
    const prefix = ref.toUpperCase().split('-')[0]
    if (['CORE', 'APP'].includes(prefix) && !body.source) {
      const error = {
        code: 'ambiguous_key',
        message: `${prefix} is known to Jira and Linear`,
        prefix,
        sources: ['jira', 'linear'],
      }
      return Response.json({ error }, { status: 409 })
    }
    const source = body.source ?? 'jira'
    return Response.json({ task: task(source, source === 'linear' ? `acme/${ref}` : ref) })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function resolving(refs: string[]) {
  let result: Resolved | undefined
  void resolveAll(refs).then((done) => (result = done))
  return () => result
}

test('asks once per prefix and remembers the answer', async () => {
  const fetchMock = stubTrackers()
  render(<PrefixDialog />)
  const result = await resolving(['CORE-5', 'OPS-1', 'core-6'])
  expect(await screen.findByText('Where is CORE-5 from?')).toBeInTheDocument()
  expect(screen.getByText('CORE is a project in Jira and a team in Linear.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Remember for CORE' }))
  fireEvent.click(screen.getByRole('button', { name: /Linear/ }))
  await waitFor(() => expect(result()).toBeDefined())
  expect(result()?.tasks.map((t) => `${t.source}:${t.key}`)).toEqual([
    'linear:acme/CORE-5',
    'jira:OPS-1',
    'linear:acme/core-6',
  ])
  expect(screen.queryByText('Where is CORE-5 from?')).toBeNull()
  const saved = fetchMock.mock.calls.find(([url]) => url === '/api/me/key-prefixes/CORE')
  expect(JSON.parse(String(saved?.[1]?.body))).toEqual({ source: 'linear' })
})

test('cancel leaves the keys of that prefix unadded', async () => {
  const fetchMock = stubTrackers()
  render(<PrefixDialog />)
  const result = await resolving(['CORE-5', 'OPS-1'])
  await screen.findByText('Where is CORE-5 from?')
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  })
  await waitFor(() => expect(result()).toBeDefined())
  expect(result()?.tasks.map((t) => t.key)).toEqual(['OPS-1'])
  expect(result()?.failed).toEqual([
    { ref: 'CORE-5', message: 'Pick where CORE keys are from to add them.' },
  ])
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('key-prefixes'))).toBe(false)
})

test('without the dialog on screen an ambiguous key just fails', async () => {
  stubTrackers()
  const { failed } = await resolveAll(['CORE-5'])
  expect(failed.map((f) => f.ref)).toEqual(['CORE-5'])
})

test('a paste with two shared prefixes asks twice, one after the other', async () => {
  stubTrackers()
  render(<PrefixDialog />)
  const result = await resolving(['CORE-5', 'APP-1', 'CORE-6'])
  await screen.findByText('Where is CORE-5 from?')
  fireEvent.click(screen.getByRole('button', { name: /Jira/ }))
  await screen.findByText('Where is APP-1 from?')
  fireEvent.click(screen.getByRole('button', { name: /Linear/ }))
  await waitFor(() => expect(result()).toBeDefined())
  expect(result()?.tasks.map((t) => `${t.source}:${t.key}`)).toEqual([
    'jira:CORE-5',
    'linear:acme/APP-1',
    'jira:CORE-6',
  ])
})

test('a second paste waits for the open question instead of failing', async () => {
  stubTrackers()
  render(<PrefixDialog />)
  const first = await resolving(['CORE-5'])
  const second = await resolving(['APP-1'])
  await screen.findByText('Where is CORE-5 from?')
  fireEvent.click(screen.getByRole('button', { name: /Linear/ }))
  await screen.findByText('Where is APP-1 from?')
  fireEvent.click(screen.getByRole('button', { name: /Jira/ }))
  await waitFor(() => expect(second()).toBeDefined())
  expect(first()?.tasks.map((t) => t.key)).toEqual(['acme/CORE-5'])
  expect(second()?.tasks.map((t) => t.key)).toEqual(['APP-1'])
})
