import { expect, test } from 'vitest'
import {
  barNodes,
  fillChoices,
  fillsOf,
  kindCounts,
  selectionLabel,
  withFill,
} from '@/canvas/selection-props'
import type { AppNode } from '@/canvas/types'

const at = { position: { x: 0, y: 0 } }
const sticky = (id: string, color = 'yellow'): AppNode =>
  ({ id, type: 'sticky', ...at, data: { text: '', color } }) as AppNode
const shape = (id: string, color = 'none'): AppNode =>
  ({ id, type: 'shape', ...at, data: { shape: 'rhombus', text: '', color } }) as AppNode
const frame = (id: string): AppNode => ({ id, type: 'frame', ...at, data: { title: '' } })
const card = (id: string): AppNode => ({ id, type: 'task_card', ...at, data: { key: 'DEMO-1' } })

test('the bar leaves out anchors and what is not selected', () => {
  const nodes: AppNode[] = [
    { ...sticky('a'), selected: true },
    sticky('b'),
    { id: 'end', type: 'anchor', ...at, data: {}, selected: true },
  ]
  expect(barNodes(nodes).map((n) => n.id)).toEqual(['a'])
})

test('a selection offers only the fills every element takes', () => {
  expect(fillChoices([shape('a')])).toContain('surface')
  expect(fillChoices([shape('a'), frame('f')])).toEqual([
    'none',
    'yellow',
    'orange',
    'pink',
    'violet',
    'blue',
    'green',
  ])
  expect(fillChoices([shape('a'), sticky('s')])).not.toContain('none')
  expect(fillChoices([sticky('s'), card('c')])).toEqual([])
  expect(fillChoices([])).toEqual([])
})

test('the fills in use come in palette order, a frame without one counts as none', () => {
  expect(fillsOf([sticky('a', 'pink'), sticky('b', 'yellow'), sticky('c', 'pink')])).toEqual([
    'yellow',
    'pink',
  ])
  expect(fillsOf([frame('f')])).toEqual(['none'])
})

test('a fill lands only on the elements that take it', () => {
  expect(withFill(sticky('a'), 'blue').data).toMatchObject({ color: 'blue' })
  expect(withFill(frame('f'), 'blue').data).toMatchObject({ color: 'blue' })
  const note = sticky('a')
  expect(withFill(note, 'none')).toBe(note)
  const task = card('c')
  expect(withFill(task, 'blue')).toBe(task)
})

test('the label names one type or counts objects', () => {
  expect(selectionLabel([sticky('a')])).toBe('Sticky note')
  expect(selectionLabel([sticky('a'), sticky('b')])).toBe('2 sticky notes')
  const mixed = [sticky('a'), shape('b'), sticky('c')]
  expect(selectionLabel(mixed)).toBe('3 objects')
  expect(kindCounts(mixed)).toEqual([
    { kind: 'sticky', count: 2 },
    { kind: 'shape', count: 1 },
  ])
})
