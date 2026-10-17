import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, useNodesState, useReactFlow } from '@xyflow/react'
import { useState } from 'react'
import { beforeAll, expect, test } from 'vitest'
import { ModuleExpanded } from '@/canvas/ModuleExpanded'
import { ModuleNode } from '@/canvas/nodes/ModuleNode'
import type { AppNode, ModuleNode as ModuleNodeType } from '@/canvas/types'
import type { GanttContent } from '@/modules/gantt/schema'
import { ExpandModuleContext } from '@/modules/expanded'

const nodeTypes = { module: ModuleNode }

beforeAll(() => {
  // xyflow measures nodes and the expanded Gantt scrolls to today; jsdom has neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView ??= () => {}
})

const content: GanttContent = {
  start: '2026-10-01',
  end: '2026-12-31',
  scale: 'week',
  labelWidth: 160,
  rows: [{ id: 'b', title: 'Design review', start: '2026-10-12', end: '2026-10-14' }],
  milestones: [],
  links: [],
}

let latest: AppNode[] = []

function Board({ readOnly = false }: { readOnly?: boolean }) {
  const [nodes, , onNodesChange] = useNodesState<AppNode>([
    {
      id: 'g',
      type: 'module',
      position: { x: 0, y: 0 },
      width: 960,
      height: 320,
      data: { kind: 'gantt', content, title: 'Q4 plan' },
    },
  ])
  const [open, setOpen] = useState<string | null>(null)
  const { updateNodeData } = useReactFlow()
  latest = nodes
  const node = nodes.find((n) => n.id === open) as ModuleNodeType | undefined
  return (
    <ExpandModuleContext.Provider value={setOpen}>
      <ReactFlow nodes={nodes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} />
      {node && (
        <ModuleExpanded
          node={node}
          readOnly={readOnly}
          onChange={(next) => updateNodeData(node.id, { content: next })}
          onClose={() => setOpen(null)}
        />
      )}
    </ExpandModuleContext.Provider>
  )
}

function renderBoard(readOnly = false) {
  render(
    <div style={{ width: 1200, height: 800 }}>
      <QueryClientProvider client={new QueryClient()}>
        <ReactFlowProvider>
          <Board readOnly={readOnly} />
        </ReactFlowProvider>
      </QueryClientProvider>
    </div>,
  )
}

const current = () => (latest[0].data as { content: GanttContent }).content

test('opens the module over the board and edits the same block', () => {
  renderBoard()
  fireEvent.click(screen.getByRole('button', { name: 'Expand', hidden: true }))
  const dialog = screen.getByRole('dialog', { name: 'Q4 plan' })
  // Days keep a readable width: 92 days of weeks at 14px after the 160px titles, scrolled sideways.
  const root = dialog.querySelector('[data-gantt-body]')!.parentElement!.parentElement!
  expect(root.style.width).toBe(`${160 + 92 * 14}px`)

  fireEvent.click(within(dialog).getByRole('button', { name: 'Add a quarter after' }))
  expect(current().end).toBe('2027-03-31')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Milestone' }))
  expect(current().milestones).toHaveLength(1)

  fireEvent.click(within(dialog).getByRole('button', { name: 'Collapse' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('keeps the view open while Esc ends an edit in a field', () => {
  renderBoard()
  fireEvent.click(screen.getByRole('button', { name: 'Expand', hidden: true }))
  const dialog = screen.getByRole('dialog')
  const field = document.createElement('input')
  dialog.append(field)
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('a viewer sees the plan without its controls', () => {
  renderBoard(true)
  fireEvent.click(screen.getByRole('button', { name: 'Expand', hidden: true }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).queryByRole('button', { name: 'Milestone' })).toBeNull()
  expect(within(dialog).getAllByText('Design review').length).toBeGreaterThan(0)
})
