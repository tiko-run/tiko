import { act, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, useViewport } from '@xyflow/react'
import { useRef } from 'react'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { readWheel, sidewaysDelta, useShiftWheelPan, useWheel, writeWheel } from '@/canvas/wheel'

beforeAll(() => {
  // xyflow measures its pane; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => act(() => writeWheel('scroll')))

describe('wheel preference', () => {
  test('is Scroll in a new browser and keeps a choice', () => {
    localStorage.removeItem('tiko.wheel')
    expect(readWheel()).toBe('scroll')
    writeWheel('zoom')
    expect(readWheel()).toBe('zoom')
    expect(localStorage.getItem('tiko.wheel')).toBe('zoom')
  })

  test('Shift + wheel goes sideways from either axis, lines counted as pixels', () => {
    expect(sidewaysDelta({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe(50)
    expect(sidewaysDelta({ deltaX: -100, deltaY: 0, deltaMode: 0 })).toBe(-50)
    expect(sidewaysDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe(30)
  })
})

// Wired as in Canvas.
function Board() {
  const zoom = useWheel() === 'zoom'
  const surface = useRef<HTMLDivElement>(null)
  useShiftWheelPan(surface, zoom)
  return (
    <div ref={surface} style={{ width: 800, height: 600 }}>
      <ReactFlow nodes={[]} edges={[]} panOnScroll={!zoom} minZoom={0.1}>
        <View />
      </ReactFlow>
    </div>
  )
}

function View() {
  const { x, y, zoom } = useViewport()
  return (
    <output data-testid="view">{`${Math.round(x)} ${Math.round(y)} ${zoom.toFixed(2)}`}</output>
  )
}

function renderBoard() {
  render(
    <ReactFlowProvider>
      <Board />
    </ReactFlowProvider>,
  )
  const pane = document.querySelector('.react-flow__pane') as HTMLElement
  const view = () => screen.getByTestId('view').textContent
  return { pane, view }
}

describe('board wheel', () => {
  test('Scroll: a swipe pans and a pinch zooms, as before', () => {
    const { pane, view } = renderBoard()
    fireEvent.wheel(pane, { deltaX: 40, deltaY: 100 })
    expect(view()).toBe('-20 -50 1.00')
    fireEvent.wheel(pane, { deltaY: -10, ctrlKey: true })
    expect(Number(view()?.split(' ')[2])).toBeGreaterThan(1)
  })

  test('Zoom: the wheel zooms, Shift + wheel pans sideways', () => {
    act(() => writeWheel('zoom'))
    const { pane, view } = renderBoard()
    fireEvent.wheel(pane, { deltaY: -100 })
    const [x, y, zoom] = (view() ?? '').split(' ').map(Number)
    expect(zoom).toBeGreaterThan(1)
    fireEvent.wheel(pane, { deltaY: 100, shiftKey: true })
    expect(view()).toBe(`${x - 50} ${y} ${zoom.toFixed(2)}`)
  })

  test('Zoom: the wheel over a nowheel area leaves the board alone', () => {
    act(() => writeWheel('zoom'))
    const { pane, view } = renderBoard()
    const field = document.createElement('div')
    field.className = 'nowheel'
    pane.append(field)
    fireEvent.wheel(field, { deltaY: -100 })
    fireEvent.wheel(field, { deltaY: 100, shiftKey: true })
    expect(view()).toBe('0 0 1.00')
  })
})
