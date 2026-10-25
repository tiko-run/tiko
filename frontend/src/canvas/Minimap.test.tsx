import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, useViewport } from '@xyflow/react'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { Minimap, minimapLook, readMinimapShown, saveMinimapShown } from '@/canvas/Minimap'
import type { AppNode } from '@/canvas/types'

const node = (type: string, data: Record<string, unknown> = {}) =>
  ({ id: type, type, position: { x: 0, y: 0 }, data }) as AppNode

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

test('notes and shapes show their fill, frames an outline, cards a neutral block', () => {
  expect(minimapLook(node('sticky', { color: 'pink' })).fill).toBe('var(--sticky-pink)')
  expect(minimapLook(node('shape', { color: 'none' }))).toEqual({
    fill: 'transparent',
    stroke: 'var(--muted-foreground)',
  })
  expect(minimapLook(node('frame')).fill).toBe('transparent')
  expect(minimapLook(node('task_card')).fill).toBe('var(--muted-foreground)')
})

test('anchors and timers draw nothing', () => {
  expect(minimapLook(node('anchor'))).toEqual({ fill: 'transparent', stroke: 'transparent' })
  expect(minimapLook(node('timer'))).toEqual({ fill: 'transparent', stroke: 'transparent' })
})

test('the minimap is shown until someone hides it, and stays hidden', () => {
  expect(readMinimapShown()).toBe(true)
  saveMinimapShown(false)
  expect(readMinimapShown()).toBe(false)
  saveMinimapShown(true)
  expect(readMinimapShown()).toBe(true)
})

beforeAll(() => {
  // xyflow measures nodes; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.setPointerCapture ??= () => {}
  // jsdom has no 2D canvas; the minimap then draws only its frame.
  HTMLCanvasElement.prototype.getContext = (() => null) as never
})

function Where() {
  const { x, y } = useViewport()
  return <output>{`${Math.round(x)} ${Math.round(y)}`}</output>
}

const board: AppNode[] = [
  { id: 'a', type: 'default', position: { x: 0, y: 0 }, width: 400, height: 300, data: {} },
] as unknown as AppNode[]

function Board() {
  return (
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={board} defaultViewport={{ x: 0, y: 0, zoom: 1 }}>
          <Minimap />
          <Where />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  )
}

test('a click on the minimap moves the view there; a drag pans the board', async () => {
  // jsdom lays nothing out, and an animated move over a view of no size has no numbers.
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  render(<Board />)
  const map = screen.getByRole('img', { name: 'Minimap' })
  const before = screen.getByRole('status').textContent
  fireEvent.pointerDown(map, { button: 0, clientX: 150, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(map, { button: 0, clientX: 150, clientY: 100, pointerId: 1 })
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(before))
  const clicked = screen.getByRole('status').textContent
  fireEvent.pointerDown(map, { button: 0, clientX: 100, clientY: 75, pointerId: 1 })
  fireEvent.pointerMove(map, { clientX: 120, clientY: 75, pointerId: 1 })
  fireEvent.pointerUp(map, { clientX: 120, clientY: 75, pointerId: 1 })
  const [x0] = clicked!.split(' ').map(Number)
  const [x1] = screen.getByRole('status').textContent!.split(' ').map(Number)
  expect(x1).toBeLessThan(x0)
})
