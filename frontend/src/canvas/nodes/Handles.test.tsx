import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { expect, test } from 'vitest'
import { ReadOnlyContext } from '@/canvas/readonly'
import { Handles } from '@/canvas/nodes/Handles'

function handles(readOnly: boolean) {
  render(
    <ReactFlowProvider>
      <ReadOnlyContext.Provider value={readOnly}>
        <Handles />
      </ReadOnlyContext.Provider>
    </ReactFlowProvider>,
  )
  return [...document.querySelectorAll('.react-flow__handle')]
}

test('a viewer cannot start an arrow from a handle', () => {
  const all = handles(true)
  expect(all).toHaveLength(4)
  for (const h of all) expect(h.classList.contains('connectable')).toBe(false)
})

test('an editor can', () => {
  for (const h of handles(false)) expect(h.classList.contains('connectable')).toBe(true)
})
