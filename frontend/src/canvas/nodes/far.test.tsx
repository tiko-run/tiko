import { act, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { beforeAll, expect, test } from 'vitest'
import { FarSticky, farView } from '@/canvas/nodes/far'
import { StickyNode } from '@/canvas/nodes/StickyNode'
import { FarContext } from '@/canvas/readonly'
import type { AppNode } from '@/canvas/types'

const nodeTypes = { sticky: farView(StickyNode, FarSticky) }

beforeAll(() => {
  // xyflow measures nodes; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const notes: AppNode[] = [
  {
    id: 's',
    type: 'sticky',
    position: { x: 0, y: 0 },
    width: 200,
    height: 160,
    data: { text: 'Book the flight and the hotel for the first week', color: 'yellow' },
  },
]

function Board({ far }: { far: boolean }) {
  return (
    <FarContext.Provider value={far}>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={notes} nodeTypes={nodeTypes} />
      </div>
    </FarContext.Provider>
  )
}

const frames = (count: number) =>
  act(async () => {
    for (let i = 0; i < count; i++) await new Promise((done) => requestAnimationFrame(done))
  })

test('far out a note is a block of bars with no text and no arrow dots', () => {
  render(
    <ReactFlowProvider>
      <Board far />
    </ReactFlowProvider>,
  )
  expect(screen.queryByText(/Book the flight/)).toBeNull()
  expect(document.querySelectorAll('.react-flow__node span.bg-current')).toHaveLength(2)
  expect(document.querySelector('.react-flow__handle')).toBeNull()
})

test('zoomed back in the note shows its text and dots again', async () => {
  const { rerender } = render(
    <ReactFlowProvider>
      <Board far />
    </ReactFlowProvider>,
  )
  rerender(
    <ReactFlowProvider>
      <Board far={false} />
    </ReactFlowProvider>,
  )
  await frames(2)
  expect(screen.getByText(/Book the flight/)).toBeTruthy()
  expect(document.querySelectorAll('.react-flow__handle')).toHaveLength(4)
})

test('a note shown close at first is full at once', () => {
  render(
    <ReactFlowProvider>
      <Board far={false} />
    </ReactFlowProvider>,
  )
  expect(screen.getByText(/Book the flight/)).toBeTruthy()
})
