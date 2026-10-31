import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, expect, test } from 'vitest'
import { Scroller } from '@/components/Scroller'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

test('the browser bars hide and ours show over the content while it scrolls', () => {
  const ref = createRef<HTMLDivElement>()
  render(
    <Scroller
      className="max-h-10"
      viewportClassName="p-1"
      viewportRef={ref}
      role="listbox"
      aria-label="Results"
    >
      <div style={{ height: 500 }} />
    </Scroller>,
  )
  const viewport = screen.getByRole('listbox', { name: 'Results' })
  expect(ref.current).toBe(viewport)
  expect(viewport.className).toContain('no-scrollbar')
  expect(viewport.className).toContain('p-1')
  expect(viewport.parentElement!.className).toContain('max-h-10')
  for (const [key, value] of Object.entries({ scrollHeight: 500, clientHeight: 40 }))
    Object.defineProperty(viewport, key, { value, configurable: true })
  act(() => {
    fireEvent.scroll(viewport)
  })
  const bar = viewport.nextElementSibling as HTMLElement
  expect(bar.className).toContain('opacity-100')
})
