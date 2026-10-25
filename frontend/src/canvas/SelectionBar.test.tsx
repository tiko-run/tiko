import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import type { ReactNode } from 'react'
import { beforeAll, expect, test, vi } from 'vitest'
import { placeBar, SelectionBar } from '@/canvas/SelectionBar'
import type { AppNode } from '@/canvas/types'

beforeAll(() => {
  // xyflow measures nodes; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const at = { position: { x: 0, y: 0 }, width: 100, height: 100, selected: true }
const sticky = (id: string, color: string): AppNode =>
  ({ id, type: 'sticky', ...at, data: { text: '', color } }) as AppNode
const shape: AppNode = {
  id: 'h',
  type: 'shape',
  ...at,
  data: { shape: 'ellipse', text: '', color: 'none' },
}
const frame: AppNode = { id: 'f', type: 'frame', ...at, data: { title: '' } }
const text = (id: string, data: object = {}): AppNode =>
  ({ id, type: 'text', ...at, data: { text: '', ...data } }) as AppNode
const card = (id: string, collapsed: boolean): AppNode => ({
  id,
  type: 'task_card',
  ...at,
  data: { key: 'DEMO-1', collapsed },
})

function renderBar(
  nodes: AppNode[],
  withTimer = false,
  controls?: (side: 'top' | 'bottom') => ReactNode,
  movable = nodes.length,
) {
  const on = {
    onAlign: vi.fn(),
    onStyle: vi.fn(),
    onPreview: vi.fn(),
    onNarrow: vi.fn(),
    onCollapse: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onAddTimer: withTimer ? vi.fn() : undefined,
  }
  render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={nodes} />
        <SelectionBar nodes={nodes} movable={movable} {...on} controls={controls} />
      </div>
    </ReactFlowProvider>,
  )
  return on
}

const button = (name: string) => screen.getByRole('button', { name })
const names = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))

test('one sticky note: its name, the fill and the actions', () => {
  const on = renderBar([sticky('a', 'yellow')], true)
  expect(screen.getByRole('toolbar', { name: 'Selection' }).textContent).toContain('Sticky note')
  fireEvent.click(button('Fill'))
  expect(button('yellow fill').getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('button', { name: 'no fill' })).toBeNull()
  fireEvent.click(button('blue fill'))
  expect(on.onStyle).toHaveBeenCalledWith({ color: 'blue' })
  fireEvent.click(button('Add timer'))
  fireEvent.click(button('Duplicate'))
  fireEvent.click(button('Delete'))
  expect(on.onAddTimer).toHaveBeenCalled()
  expect(on.onDuplicate).toHaveBeenCalled()
  expect(on.onDelete).toHaveBeenCalled()
})

test('notes in two colors: no swatch is picked, and a swatch previews on hover', () => {
  const on = renderBar([sticky('a', 'yellow'), sticky('b', 'pink')])
  expect(screen.getByRole('toolbar').textContent).toContain('2 sticky notes')
  fireEvent.click(button('Fill'))
  expect(button('yellow fill').getAttribute('aria-pressed')).toBe('false')
  expect(button('pink fill').getAttribute('aria-pressed')).toBe('false')
  fireEvent.pointerEnter(button('green fill'))
  expect(on.onPreview).toHaveBeenLastCalledWith({ color: 'green' })
  expect(on.onStyle).not.toHaveBeenCalled()
  fireEvent.pointerLeave(button('green fill').parentElement!)
  expect(on.onPreview).toHaveBeenLastCalledWith(null)
})

test('a shape and a frame share no fill and the six colors, a shape alone adds the plain fill', () => {
  renderBar([shape, frame])
  fireEvent.click(button('Fill'))
  expect(button('no fill')).toBeTruthy()
  for (const color of ['yellow', 'orange', 'pink', 'violet', 'blue', 'green'])
    expect(button(`${color} fill`)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'plain fill' })).toBeNull()
})

test('a shape alone offers the plain fill', () => {
  renderBar([shape])
  fireEvent.click(button('Fill'))
  expect(button('plain fill')).toBeTruthy()
})

test('a mixed selection narrows to one type', () => {
  const on = renderBar([sticky('a', 'yellow'), sticky('b', 'yellow'), shape])
  fireEvent.click(button('Filter 3 objects'))
  expect(screen.getByRole('button', { name: /^Sticky notes\s*2$/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Shapes/ }))
  expect(on.onNarrow).toHaveBeenCalledWith('shape')
})

test('cards alone get Collapse, cards with notes only the actions', () => {
  const on = renderBar([card('a', false), card('b', true)])
  expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull()
  fireEvent.click(button('Collapse cards'))
  expect(on.onCollapse).toHaveBeenCalledWith(true)
})

test('cards with a note: no fill, no collapse', () => {
  renderBar([card('a', false), sticky('s', 'yellow')])
  expect(names()).toEqual(['Filter 2 objects', 'Align', 'Duplicate', 'Delete'])
})

test('collapsed cards offer Expand', () => {
  const on = renderBar([card('a', true)])
  fireEvent.click(button('Expand card'))
  expect(on.onCollapse).toHaveBeenCalledWith(false)
})

test('elements at different opacity read Mixed, and the slider starts at the highest', () => {
  renderBar([sticky('a', 'yellow'), { ...shape, data: { ...shape.data, opacity: 40 } } as AppNode])
  fireEvent.click(button('Opacity'))
  expect(button('Opacity').textContent).toBe('Mixed')
  expect(screen.getByRole('slider', { name: 'Opacity' }).getAttribute('aria-valuenow')).toBe('100')
})

test('a task card in the selection takes no opacity', () => {
  renderBar([card('a', false), sticky('s', 'yellow')])
  expect(screen.queryByRole('button', { name: 'Opacity' })).toBeNull()
})

test('a shape offers the outline: widths and dashed, previewed before the pick', () => {
  const on = renderBar([shape])
  fireEvent.click(button('Outline'))
  expect(button('1.5px outline').getAttribute('aria-pressed')).toBe('true')
  fireEvent.pointerEnter(button('3px outline'))
  expect(on.onPreview).toHaveBeenLastCalledWith({ stroke: 3 })
  fireEvent.click(button('Dashed'))
  expect(on.onStyle).toHaveBeenCalledWith({ dash: true })
})

test('text takes size and bold, no outline; a note has bold only', () => {
  const on = renderBar([text('a', { size: 'large', bold: true }), text('b', { size: 'large' })])
  expect(screen.queryByRole('button', { name: 'Outline' })).toBeNull()
  expect(button('Bold').getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(button('Bold'))
  expect(on.onStyle).toHaveBeenLastCalledWith({ bold: true })
  fireEvent.click(button('Text size'))
  expect(button('Large').getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(button('Small'))
  expect(on.onStyle).toHaveBeenLastCalledWith({ size: 'small' })
})

test('a note has bold but no text size', () => {
  renderBar([sticky('a', 'yellow')])
  expect(button('Bold')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Text size' })).toBeNull()
})

test('a module brings its own controls into the bar', () => {
  const gantt = { id: 'g', type: 'module', ...at, data: { kind: 'gantt', content: {} } } as AppNode
  renderBar([gantt], false, (side) => <button type="button">{`Weeks ${side}`}</button>)
  const bar = screen.getByRole('toolbar', { name: 'Selection' })
  // No room above a module at the top of the canvas: the bar and its popovers go below.
  expect(within(bar).getByRole('button', { name: 'Weeks bottom' })).toBeTruthy()
  expect(within(bar).getByRole('button', { name: 'Delete' })).toBeTruthy()
})

test('two elements get the six alignments and no distribution', () => {
  const on = renderBar([sticky('a', 'yellow'), sticky('b', 'blue')])
  fireEvent.click(button('Align'))
  expect(screen.queryByRole('button', { name: 'Distribute horizontally' })).toBeNull()
  fireEvent.click(button('Align top'))
  expect(on.onAlign).toHaveBeenCalledWith('top')
})

test('three elements can be distributed', () => {
  const on = renderBar([sticky('a', 'yellow'), sticky('b', 'blue'), sticky('c', 'pink')])
  fireEvent.click(button('Align'))
  fireEvent.click(button('Distribute vertically'))
  expect(on.onAlign).toHaveBeenCalledWith('vertical')
})

test('one element on its own offers no align', () => {
  renderBar([sticky('a', 'yellow'), sticky('b', 'blue')], false, undefined, 1)
  expect(screen.queryByRole('button', { name: 'Align' })).toBeNull()
})

// A 1200x800 canvas, the focus timer at the top center and the menu in the top left corner.
const timer = { left: 468, right: 732, bottom: 110 }
const menu = { left: 16, right: 300, bottom: 58 }
const bar = { width: 400, height: 40 }
const selection = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
  width: 1200,
  height: 800,
})

test('a selection near the top puts the bar below the focus timer, not under it', () => {
  const place = placeBar(selection(200, 100, 1000, 700), bar, [timer, menu])
  expect(place.above).toBe(false)
  expect(place.top).toBeGreaterThanOrEqual(timer.bottom + 8)
})

test('the bar goes above the selection once it fits under the focus timer', () => {
  const place = placeBar(selection(200, 200, 1000, 700), bar, [timer, menu])
  expect(place).toEqual({ left: 600, top: 148, above: true })
})

test('without the focus timer the bar keeps close to the top', () => {
  const place = placeBar(selection(200, 100, 1000, 700), bar, [menu])
  expect(place).toEqual({ left: 600, top: 48, above: true })
})

test('only panels over the bar push it down', () => {
  // A bar on the right side spans neither the timer nor the menu.
  const place = placeBar(selection(900, 70, 1100, 300), bar, [timer, menu])
  expect(place).toEqual({ left: 992, top: 18, above: true })
})
