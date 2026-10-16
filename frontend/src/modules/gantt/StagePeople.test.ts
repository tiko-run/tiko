import { expect, test } from 'vitest'
import type { Person } from '@/api/planning'
import { stagePeople, suggestions } from '@/modules/gantt/StagePeople'

const person = (id: string, name: string, archived = false): Person => ({
  id,
  name,
  teams: [],
  source: 'manual',
  archived,
})
const people = [person('p1', 'Ivan'), person('p2', 'Anna', true), person('p3', 'Ivana')]

const labels = (query: string, chosen: string[] = [], assignees: string[] = []) =>
  suggestions(query, chosen, people, assignees).map((s) =>
    s.kind === 'person' ? s.person.name : `${s.kind}:${s.name}`,
  )

test('the list matches by part of the name and leaves out the archived and the chosen', () => {
  expect(labels('iv')).toEqual(['Ivan', 'Ivana', 'new:iv'])
  expect(labels('iv', ['p1'])).toEqual(['Ivana', 'new:iv'])
  expect(labels('ann')).toEqual(['new:ann'])
})

test('assignees nobody added yet come after the list, marked as from the tracker', () => {
  expect(labels('', [], ['Oleg', 'Ivan', 'Anna'])).toEqual(['Ivan', 'Ivana', 'tracker:Oleg'])
})

test('a new name is offered only when nobody has it', () => {
  expect(labels('Ivan')).toEqual(['Ivan', 'Ivana'])
  expect(labels('oleg', [], ['Oleg'])).toEqual(['tracker:Oleg'])
  expect(labels(' Petra ')).toEqual(['new:Petra'])
  // Anna is archived: neither offered nor added again under her name.
  expect(labels('Anna')).toEqual([])
})

test('nobody is suggested before the field is used, so nothing is imported in bulk', () => {
  expect(suggestions('', [], [], ['Oleg', 'Mia'])).toHaveLength(2)
  expect(suggestions('', [], [], [])).toEqual([])
})

test('an id the instance does not know reads Unknown', () => {
  expect(stagePeople(['p1', 'gone'], people)).toEqual([
    { id: 'p1', name: 'Ivan', archived: false },
    { id: 'gone', name: 'Unknown', archived: true },
  ])
})
