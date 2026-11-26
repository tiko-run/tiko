import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { JqlInput } from '@/canvas/JqlInput'

const vocabulary = {
  fields: [
    { name: 'status', label: 'status', operators: ['=', '!=', 'in'] },
    { name: 'cf[10020]', label: 'Sprint - cf[10020]', operators: ['=', 'in'] },
  ],
  functions: ['currentUser()'],
  keywords: ['AND', 'OR'],
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/jql/vocabulary')) return Response.json(vocabulary)
      if (url.startsWith('/api/jql/values')) {
        return Response.json({ values: [{ value: '"In Progress"', label: 'In Progress' }] })
      }
      return new Response(null, { status: 404 })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function Field() {
  const [value, setValue] = useState('')
  return <JqlInput aria-label="Query" value={value} onValueChange={setValue} />
}

function renderField() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Field />
    </QueryClientProvider>,
  )
  return screen.getByLabelText('Query') as HTMLTextAreaElement
}

function type(field: HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value, selectionStart: value.length } })
}

test('Tab inserts the first matching field, then operators are offered', async () => {
  const field = renderField()
  type(field, 'sta')
  expect(await screen.findByRole('option', { name: 'status' })).toBeTruthy()
  fireEvent.keyDown(field, { key: 'Tab' })
  expect(field.value).toBe('status ')
  type(field, 'status ')
  expect(await screen.findByRole('option', { name: '!=' })).toBeTruthy()
})

test('custom fields match by their label and insert their id', async () => {
  const field = renderField()
  type(field, 'spr')
  const option = await screen.findByRole('option', { name: /Sprint/ })
  fireEvent.mouseDown(option)
  expect(field.value).toBe('cf[10020] ')
})

test('values come from Jira and Enter completes a half-typed word', async () => {
  const field = renderField()
  type(field, 'status = In')
  await screen.findByRole('option', { name: /In Progress/ })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(field.value).toBe('status = "In Progress" ')
})

test('Shift+Enter breaks the line and an IME confirmation is left alone', async () => {
  const field = renderField()
  type(field, 'status = In')
  await screen.findByRole('option', { name: /In Progress/ })
  fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
  expect(field.value).toBe('status = In')
  const shift = fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
  expect(shift).toBe(true)
  expect(field.value).toBe('status = In')
})

test('Enter submits when the word is already whole or nothing is typed after it', async () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  function Form() {
    const [value, setValue] = useState('')
    return (
      <form onSubmit={onSubmit}>
        <JqlInput aria-label="Query" value={value} onValueChange={setValue} />
      </form>
    )
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Form />
    </QueryClientProvider>,
  )
  const field = screen.getByLabelText('Query') as HTMLTextAreaElement
  type(field, 'status')
  await screen.findByRole('option', { name: 'status' })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(onSubmit).toHaveBeenCalledOnce()
  type(field, 'status = "In Progress" ')
  await screen.findByRole('option', { name: 'AND' })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(onSubmit).toHaveBeenCalledTimes(2)
  expect(field.value).toBe('status = "In Progress" ')
})

test('an issue key shows no list and Escape closes it', async () => {
  const field = renderField()
  type(field, 'DEV-15')
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(screen.queryByRole('listbox')).toBeNull()
  type(field, 'sta')
  await screen.findByRole('listbox')
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
})

test('a multi-line query keeps its lines and Enter submits it', async () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  function Form() {
    const [value, setValue] = useState('')
    return (
      <form onSubmit={onSubmit}>
        <JqlInput aria-label="Query" value={value} onValueChange={setValue} />
      </form>
    )
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Form />
    </QueryClientProvider>,
  )
  const field = screen.getByLabelText('Query') as HTMLTextAreaElement
  const query = '(\n  key in (DEMO-1)\n  OR "Epic Link" in (DEMO-1)\n)\nAND status != Done'
  type(field, query)
  fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
  expect(onSubmit).not.toHaveBeenCalled()
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(onSubmit).toHaveBeenCalledOnce()
  expect(field.value).toBe(query)
})
