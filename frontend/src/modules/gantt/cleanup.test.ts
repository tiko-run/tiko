import { expect, test } from 'vitest'
import cases from '@/modules/gantt/cleanup.fixtures.json'
import { syncDone } from '@/modules/gantt/done'
import { detachEdited } from '@/modules/gantt/follow'
import type { GanttContent } from '@/modules/gantt/schema'
import { fitLeaves } from '@/modules/gantt/stages'

// The API runs the same clean-up after every step (backend/app/domain/gantt_steps.py); the
// backend reads these cases too, so the two stay in step.
test.each(cases)('$name', ({ before, after }) => {
  const content = before as GanttContent
  expect(detachEdited(content, fitLeaves(syncDone(content))).content).toEqual(after)
})
