import { expect, test } from 'vitest'
import { reactionsOf, reactors, toggled, withoutReactions } from '@/canvas/reactions'

const sticky = (reactions: Record<string, string[]>) => ({
  text: 'Retro',
  color: 'yellow',
  ...Object.fromEntries(Object.entries(reactions).map(([who, ids]) => [`reaction:${who}`, ids])),
})

test('reactions are counted per emoji in the set order', () => {
  const data = sticky({ ann: ['dislike', 'like'], bob: ['like'] })
  expect(reactionsOf(data)).toEqual([
    { id: 'like', people: ['ann', 'bob'] },
    { id: 'dislike', people: ['ann'] },
  ])
  expect(reactionsOf({ text: 'none' })).toEqual([])
})

test('a pick adds a reaction and a second pick takes it back', () => {
  const [added] = toggled([sticky({ bob: ['like'] })], 'ann', 'party')
  expect(added).toEqual(['party'])
  const [kept] = toggled([sticky({ ann: ['like', 'party'] })], 'ann', 'party')
  expect(kept).toEqual(['like'])
  const [gone] = toggled([sticky({ ann: ['party'] })], 'ann', 'party')
  expect(gone).toBeUndefined()
})

test('on several elements a pick goes on all unless every one has it', () => {
  const some = [sticky({ ann: ['like'] }), sticky({})]
  expect(toggled(some, 'ann', 'like')).toEqual([['like'], ['like']])
  const all = [sticky({ ann: ['like'] }), sticky({ ann: ['like', 'love'] })]
  expect(toggled(all, 'ann', 'like')).toEqual([undefined, ['love']])
})

test('names put the viewer first and a person who left as Former member', () => {
  const names = new Map([
    ['ann', 'Ann'],
    ['bob', 'Bob'],
    ['cy', 'Cy'],
  ])
  expect(reactors(['cy', 'gone', 'ann', 'bob'], 'bob', names).map((p) => p.name)).toEqual([
    'You',
    'Ann',
    'Cy',
    'Former member',
  ])
})

test('a copy drops reactions and keeps the rest', () => {
  expect(withoutReactions(sticky({ ann: ['like'] }))).toEqual({ text: 'Retro', color: 'yellow' })
})
