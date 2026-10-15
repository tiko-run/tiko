import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useAutoTour } from '@/onboarding/start'
import { driveSteps, STEPS } from '@/onboarding/tour'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.querySelectorAll('.driver-popover, .driver-overlay').forEach((node) => node.remove())
  document.body.innerHTML = ''
})

function words(html: string) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length
}

test('each step says it in under 25 words, without exclamation marks', () => {
  for (const step of STEPS) {
    expect(words(step.text), step.id).toBeLessThan(25)
    expect(step.text + step.title).not.toContain('!')
  }
})

test('a step points at its anchor, or is centered when the anchor is not on screen', () => {
  document.body.innerHTML = '<button data-tour="tool-card"></button>'
  const steps = driveSteps()
  expect(steps).toHaveLength(7)
  expect(steps[1].element).toBe(document.querySelector('[data-tour="tool-card"]'))
  // The focus capsule is hidden here, so its step has no element.
  expect(steps[5].element).toBeUndefined()
  expect(steps[0].element).toBeUndefined()
})

test('one step can run on its own', () => {
  const steps = driveSteps('gantt')
  expect(steps).toHaveLength(1)
  expect(steps[0].popover?.title).toBe('Plan on a Gantt')
  expect(steps[0].popover?.description).toContain('tour-loop')
})

function Board() {
  useAutoTour()
  return <p>board</p>
}

function mount(state: object) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(state), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Board />
    </QueryClientProvider>,
  )
  return fetch
}

test('starts by itself for a person who has not seen it, and marks it seen when closed', async () => {
  const fetch = mount({ tour_seen: false, done: {}, hidden: false })
  expect(await screen.findByText('Welcome to tiko', {}, { timeout: 3000 })).toBeInTheDocument()
  screen.getByRole('button', { name: 'Close' }).click()
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/me/onboarding',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ tour_seen: true }) }),
    ),
  )
})

test('does not start for a person who has seen it', async () => {
  const fetch = mount({ tour_seen: true, done: {}, hidden: false })
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 1000))
  expect(screen.queryByText('Welcome to tiko')).toBeNull()
})
