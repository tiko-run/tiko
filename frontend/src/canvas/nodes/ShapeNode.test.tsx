import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, useNodesState } from '@xyflow/react'
import { beforeAll, expect, test } from 'vitest'
import { ShapeNode } from '@/canvas/nodes/ShapeNode'
import { ReadOnlyContext } from '@/canvas/readonly'
import { SHAPE_MAX_CHARS, shapePath } from '@/canvas/shapes'
import type { AppNode } from '@/canvas/types'

const nodeTypes = { shape: ShapeNode }

beforeAll(() => {
  // xyflow measures nodes; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

function Board({ selected }: { selected?: boolean }) {
  const [nodes, , onNodesChange] = useNodesState<AppNode>([
    {
      id: 'd',
      type: 'shape',
      position: { x: 0, y: 0 },
      width: 160,
      height: 100,
      selected,
      data: { shape: 'rhombus', text: 'Valid?', color: 'none' },
    },
  ])
  return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} />
}

function renderBoard(props: { selected?: boolean; readOnly?: boolean } = {}) {
  return render(
    <ReadOnlyContext.Provider value={props.readOnly ?? false}>
      <ReactFlowProvider>
        <div style={{ width: 800, height: 600 }}>
          <Board selected={props.selected} />
        </div>
      </ReactFlowProvider>
    </ReadOnlyContext.Provider>,
  )
}

test('draws its outline at the size of the node', () => {
  const { container } = renderBoard()
  const path = container.querySelector('.react-flow__node-shape path')
  expect(path?.getAttribute('d')).toBe(shapePath('rhombus', 160, 100))
})

test('double-click edits the text up to the limit', () => {
  renderBoard()
  fireEvent.doubleClick(screen.getByText('Valid?'))
  const field = screen.getByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement
  expect(field.maxLength).toBe(SHAPE_MAX_CHARS)
})

test('a read-only board opens no editor', () => {
  renderBoard({ readOnly: true })
  fireEvent.doubleClick(screen.getByText('Valid?'))
  expect(screen.queryByRole('textbox', { name: 'Text' })).toBeNull()
})
