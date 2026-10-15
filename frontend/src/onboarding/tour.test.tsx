import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useAutoTour } from '@/onboarding/start'
import { driveSteps, runTour, STEPS } from '@/onboarding/tour'

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

test('reduced motion turns the moving highlight off', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const tour = runTour()
  expect(tour.getConfig().animate).toBe(false)
  tour.destroy()
})

test('the tour and driver.js are only loaded on demand', () => {
  // A static import would pull them into the board's chunk.
  const files = import.meta.glob('/src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
  for (const [path, source] of Object.entries(files)) {
    if (path.startsWith('/src/onboarding/')) continue
    expect(source as string, path).not.toMatch(
      /from ['"](driver\.js|@\/onboarding\/(tour|loops))['"]/,
    )
  }
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

test('while the tour runs the board gets no keys, pastes or clicks on the highlighted button', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  document.body.innerHTML = '<button data-tour="tool-card"></button>'
  const board = vi.fn()
  document.addEventListener('keydown', board)
  document.addEventListener('paste', board)
  const tour = runTour()
  // The step settles on the next frame.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
  await settle()
  tour.moveNext()
  await settle()
  const button = document.querySelector('[data-tour="tool-card"]')!
  expect(button).toHaveClass('driver-no-interaction')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
  document.dispatchEvent(new Event('paste', { bubbles: true }))
  document
    .querySelector<SVGPathElement>('.driver-overlay path')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(board).not.toHaveBeenCalled()
  expect(tour.isActive()).toBe(true)
  tour.destroy()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
  expect(board).toHaveBeenCalledTimes(1)
  document.removeEventListener('keydown', board)
  document.removeEventListener('paste', board)
})
