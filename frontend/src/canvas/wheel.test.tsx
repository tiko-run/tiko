import { act, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, useViewport } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import {
  isMouseWheel,
  readWheel,
  sidewaysDelta,
  useWheel,
  useWheelMode,
  wheelAction,
  writeWheel,
} from '@/canvas/wheel'

beforeAll(() => {
  // xyflow measures its pane; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => act(() => writeWheel('auto')))

describe('wheel preference', () => {
  test('is Auto in a new browser and keeps a choice', () => {
    localStorage.removeItem('tiko.wheel')
    expect(readWheel()).toBe('auto')
    writeWheel('zoom')
    expect(readWheel()).toBe('zoom')
    expect(localStorage.getItem('tiko.wheel')).toBe('zoom')
  })

  test('Shift + wheel goes sideways from either axis, lines and pages counted as pixels', () => {
    expect(sidewaysDelta({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe(50)
    expect(sidewaysDelta({ deltaX: -100, deltaY: 0, deltaMode: 0 })).toBe(-50)
    expect(sidewaysDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe(30)
    expect(sidewaysDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toBe(window.innerWidth / 2)
  })
})

const keys = { shiftKey: false, ctrlKey: false, metaKey: false }
// Recorded shapes: a Chrome mouse notch, a macOS trackpad swipe, a Firefox mouse in lines.
const mouse = { deltaX: 0, deltaY: 100, deltaMode: 0, wheelDeltaY: -120 }
const trackpad = { deltaX: 0, deltaY: 7.5, deltaMode: 0, wheelDeltaY: -22 }
const firefoxMouse = { deltaX: 0, deltaY: 3, deltaMode: 1 }

describe('telling a mouse from a trackpad', () => {
  test('mouse notches and lines are a mouse', () => {
    expect(isMouseWheel(mouse)).toBe(true)
    expect(isMouseWheel({ ...mouse, deltaY: 4, wheelDeltaY: -120 })).toBe(true)
    expect(isMouseWheel(firefoxMouse)).toBe(true)
  })

  test('swipes are a trackpad', () => {
    expect(isMouseWheel(trackpad)).toBe(false)
    expect(isMouseWheel({ deltaX: 2, deltaY: 30, deltaMode: 0, wheelDeltaY: -90 })).toBe(false)
    expect(isMouseWheel({ deltaX: 0, deltaY: 1.5, deltaMode: 0 })).toBe(false)
  })

  test('Auto zooms on a mouse only, and leaves modifier keys to xyflow', () => {
    expect(wheelAction({ ...mouse, ...keys }, 'auto')).toBe('zoom')
    expect(wheelAction({ ...trackpad, ...keys }, 'auto')).toBe(null)
    expect(wheelAction({ ...mouse, ...keys, shiftKey: true }, 'auto')).toBe(null)
    expect(wheelAction({ ...mouse, ...keys, ctrlKey: true }, 'auto')).toBe(null)
    expect(wheelAction({ ...mouse, ...keys }, 'scroll')).toBe(null)
    expect(wheelAction({ ...trackpad, ...keys, shiftKey: true }, 'zoom')).toBe('sideways')
  })
})

// Wired as in Canvas, where the surface mounts a render later, once the board loads.
function Board() {
  const mode = useWheel()
  const [surface, setSurface] = useState<HTMLDivElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  useWheelMode(surface, mode)
  useEffect(() => setLoaded(true), [])
  if (!loaded) return null
  return (
    <div ref={setSurface} style={{ width: 800, height: 600 }}>
      <ReactFlow nodes={[]} edges={[]} panOnScroll={mode !== 'zoom'} minZoom={0.1}>
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

// fireEvent cannot set the legacy wheelDeltaY that tells a mouse apart.
function roll(target: Element, init: typeof mouse) {
  const event = new WheelEvent('wheel', { ...init, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'wheelDeltaY', { value: init.wheelDeltaY })
  act(() => void target.dispatchEvent(event))
}

describe('board wheel', () => {
  test('Auto: a mouse wheel zooms, a trackpad swipe pans', () => {
    const { pane, view } = renderBoard()
    roll(pane, { ...mouse, deltaY: -100, wheelDeltaY: 120 })
    const [x, y, zoom] = (view() ?? '').split(' ').map(Number)
    expect(zoom).toBeGreaterThan(1)
    roll(pane, trackpad)
    expect(view()).toBe(`${x} ${Math.round(y - 3.75)} ${zoom.toFixed(2)}`)
  })

  test('Scroll: a swipe pans and a pinch zooms, as before', () => {
    act(() => writeWheel('scroll'))
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
