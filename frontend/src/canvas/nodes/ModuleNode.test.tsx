import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, useNodesState, useReactFlow } from '@xyflow/react'
import { beforeAll, expect, test } from 'vitest'
import { moduleControls } from '@/canvas/module-controls'
import { ModuleNode } from '@/canvas/nodes/ModuleNode'
import type { AppNode, ModuleNode as ModuleNodeType } from '@/canvas/types'

const nodeTypes = { module: ModuleNode }

beforeAll(() => {
  // xyflow measures nodes; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const gantt = {
  start: '2026-10-01',
  end: '2026-12-31',
  scale: 'week',
  rows: [],
  milestones: [],
  links: [],
}

function Board({ data }: { data: ModuleNodeType['data'] }) {
  const [nodes, , onNodesChange] = useNodesState<AppNode>([
    {
      id: 'm',
      type: 'module',
      position: { x: 0, y: 0 },
      width: 960,
      height: 320,
      selected: true,
      data,
    },
  ])
  const { updateNodeData } = useReactFlow()
  return (
    <>
      {/* The canvas puts these in the selection bar. */}
      {moduleControls(
        nodes[0] as ModuleNodeType,
        (content) => updateNodeData('m', { content }),
        'top',
      )}
      <ReactFlow nodes={nodes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} />
    </>
  )
}

function renderModule(data: ModuleNodeType['data']) {
  render(
    <div style={{ width: 1200, height: 800 }}>
      <QueryClientProvider client={new QueryClient()}>
        <ReactFlowProvider>
          <Board data={data} />
        </ReactFlowProvider>
      </QueryClientProvider>
    </div>,
  )
}

test('renders a known module through its view', () => {
  renderModule({ kind: 'gantt', content: gantt })
  expect(screen.getByText('Gantt')).toBeTruthy()
  expect(screen.getByText('Oct 2026')).toBeTruthy()
  expect(screen.getByText('5–11')).toBeTruthy()
})

test('keeps an unknown kind as a placeholder', () => {
  renderModule({ kind: 'future_thing', content: { anything: 1 } })
  expect(screen.getByText(/Unknown module "future_thing"/)).toBeTruthy()
})

test('shows a placeholder for content it cannot read', () => {
  renderModule({ kind: 'gantt', content: { start: 'soon' } })
  expect(screen.getByText(/cannot read/)).toBeTruthy()
})

test('switches the scale from the controls', () => {
  renderModule({ kind: 'gantt', content: gantt })
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Scale: Weeks' }), { button: 0 })
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Months' }))
  expect(screen.getByText('Nov')).toBeTruthy()
})
