import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { expect, test, vi } from 'vitest'
import { Reactions } from '@/canvas/nodes/Reactions'
import { ReactionsContext, type ReactionsHost } from '@/canvas/reactions'

const people = Array.from({ length: 8 }, (_, n) => `p${n}`)
const names = new Map(people.map((id, n) => [id, `Person ${n}`]))

function board(host: ReactionsHost) {
  const data = {
    text: 'Retro',
    color: 'yellow',
    ...Object.fromEntries(people.map((id) => [`reaction:${id}`, ['like']])),
    'reaction:p0': ['like', 'party'],
  }
  render(
    <ReactFlowProvider>
      <ReactionsContext.Provider value={host}>
        <Reactions id="s" data={data} />
      </ReactionsContext.Provider>
    </ReactFlowProvider>,
  )
}

test('chips show counts, the own one pressed, and a click reacts', () => {
  const react = vi.fn()
  board({ me: 'p0', names, react })
  const like = screen.getByRole('button', { name: 'Like: 8' })
  expect(like.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Celebrate: 1' })).toBeTruthy()
  fireEvent.click(like)
  expect(react).toHaveBeenCalledWith(['s'], 'like')
  expect(screen.getByRole('button', { name: 'Add reaction' })).toBeTruthy()
})

test('hover names five people, and "and N more" lists them all', async () => {
  board({ me: 'p0', names, react: vi.fn() })
  fireEvent.pointerEnter(screen.getByRole('button', { name: 'Like: 8' }))
  const list = await screen.findByRole('list', { name: 'Reacted' })
  expect(list.textContent).toContain('You')
  expect(list.querySelectorAll('li')).toHaveLength(5)
  fireEvent.click(screen.getByRole('button', { name: 'and 3 more' }))
  expect(screen.getByRole('list', { name: 'Reacted' }).querySelectorAll('li')).toHaveLength(8)
})

test('a viewer cannot react, and a guest sees counts without names', async () => {
  board({ me: 'p1', names: null })
  expect(screen.queryByRole('button', { name: 'Add reaction' })).toBeNull()
  const like = screen.getByRole('button', { name: 'Like: 8' })
  expect(like.getAttribute('aria-pressed')).toBeNull()
  fireEvent.pointerEnter(like)
  await new Promise((done) => setTimeout(done, 400))
  expect(screen.queryByRole('list', { name: 'Reacted' })).toBeNull()
})

test('a signed-in viewer sees names but cannot react', async () => {
  board({ me: 'p1', names })
  expect(screen.queryByRole('button', { name: 'Add reaction' })).toBeNull()
  fireEvent.pointerEnter(screen.getByRole('button', { name: 'Like: 8' }))
  const list = await screen.findByRole('list', { name: 'Reacted' })
  expect(list.textContent).toContain('You')
})
