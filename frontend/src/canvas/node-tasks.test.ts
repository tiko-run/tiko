import { expect, test } from 'vitest'
import { hasMixedSources } from '@/canvas/node-tasks'
import type { AppNode } from '@/canvas/types'

const card = (id: string, source?: string): AppNode => ({
  id,
  type: 'task_card',
  position: { x: 0, y: 0 },
  data: { key: 'DEMO-1', ...(source && { source }) },
})

const gantt = (source?: string): AppNode => ({
  id: 'g',
  type: 'module',
  position: { x: 0, y: 0 },
  data: {
    kind: 'gantt',
    content: {
      start: '2026-10-01',
      end: '2026-10-31',
      scale: 'week',
      rows: [{ id: 'r', key: 'DEMO-2', title: '', start: '2026-10-05', end: '2026-10-09', source }],
    },
  },
})

test('a board is mixed once its tasks come from two trackers', () => {
  expect(hasMixedSources([], 'jira')).toBe(false)
  expect(hasMixedSources([card('a'), card('b', 'jira')], 'jira')).toBe(false)
  expect(hasMixedSources([card('a'), card('b', 'demo')], 'jira')).toBe(true)
  expect(hasMixedSources([card('a'), card('b', 'demo')], 'demo')).toBe(false)
})

test('tasks inside a module count', () => {
  expect(hasMixedSources([card('a'), gantt()], 'jira')).toBe(false)
  expect(hasMixedSources([card('a'), gantt('demo')], 'jira')).toBe(true)
})
