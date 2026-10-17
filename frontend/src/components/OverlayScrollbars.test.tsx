import { act, fireEvent, render } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { OverlayScrollbars } from '@/components/OverlayScrollbars'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

function scroller(size: { scrollWidth: number; clientWidth: number }) {
  const el = document.createElement('div')
  for (const [key, value] of Object.entries({ ...size, scrollHeight: 100, clientHeight: 100 }))
    Object.defineProperty(el, key, { value, configurable: true })
  document.body.append(el)
  return el
}

test('shows a bar after the fixed columns while it scrolls, then fades it', () => {
  vi.useFakeTimers()
  const el = scroller({ scrollWidth: 2000, clientWidth: 1000 })
  const { container } = render(<OverlayScrollbars target={el} insetLeft={300} />)
  const bar = container.firstElementChild as HTMLElement
  expect(bar.style.left).toBe('302px')
  expect(bar.className).toContain('opacity-0')
  act(() => {
    fireEvent.scroll(el)
  })
  expect(bar.className).toContain('opacity-100')
  act(() => {
    vi.advanceTimersByTime(1100)
  })
  expect(bar.className).toContain('opacity-0')
  vi.useRealTimers()
})

test('draws nothing when all fits', () => {
  const el = scroller({ scrollWidth: 1000, clientWidth: 1000 })
  const { container } = render(<OverlayScrollbars target={el} />)
  expect(container.childElementCount).toBe(0)
})
