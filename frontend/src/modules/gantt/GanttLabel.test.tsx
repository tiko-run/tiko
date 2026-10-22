import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { expect, test, vi } from 'vitest'
import { GanttLabel } from '@/modules/gantt/GanttLabel'
import type { Row } from '@/modules/gantt/rows'
import { BoardSourcesContext } from '@/sources/board-sources'

const row: Row = {
  id: 'r1',
  title: '',
  key: 'DEMO-1',
  source: 'jira',
  start: '2026-10-05',
  end: '2026-10-09',
}

function renderLabel(mixed: boolean) {
  const noop = vi.fn()
  render(
    <ReactFlowProvider>
      <BoardSourcesContext.Provider value={{ mixed, defaultSource: 'jira' }}>
        <GanttLabel
          row={row}
          depth={0}
          hasChildren={false}
          height={34}
          onTitle={noop}
          onRemove={noop}
          onToggle={noop}
          onIndent={noop}
          onOutdent={noop}
          onAddChild={noop}
          onMove={noop}
          onEject={noop}
        />
      </BoardSourcesContext.Provider>
    </ReactFlowProvider>,
  )
  return document.querySelector('.group\\/label') as HTMLElement
}

test('on a board with mixed trackers the mark takes the grip slot, not room from the title', () => {
  const label = renderLabel(true)
  const mark = screen.getByRole('img', { name: 'Jira' })
  expect(label.firstElementChild!.contains(mark)).toBe(true)
  expect(screen.getByText('DEMO-1').parentElement!.contains(mark)).toBe(false)
  // The grip comes back on hover, in the same 14px slot.
  const grip = label.querySelector('.lucide-grip-vertical')!
  expect(grip.getAttribute('class')).toContain('group-hover/label:block')
  expect(label.firstElementChild!.className).toContain('group-hover/label:hidden')
})

test('on a board with one tracker the row keeps its grip and has no mark', () => {
  const label = renderLabel(false)
  expect(screen.queryByRole('img')).toBeNull()
  expect(label.firstElementChild!.getAttribute('class')).toContain('lucide-grip-vertical')
  expect(label.firstElementChild!.getAttribute('class')).not.toContain('hidden')
})
