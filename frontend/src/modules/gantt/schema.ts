import { z } from 'zod'
import { currentQuarter, formatDay, today } from '@/modules/gantt/timeline'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// Mirrors backend/app/domain/modules/gantt.py; the backend enforces the cross-field rules.
export const ganttSchema = z.object({
  start: isoDate,
  end: isoDate,
  scale: z.enum(['day', 'week', 'month', 'quarter']),
  labelWidth: z.number().default(160),
  rows: z
    .array(
      z.object({
        id: z.string(),
        key: z.string().optional(),
        source: z.string().optional(),
        title: z.string(),
        start: isoDate,
        end: isoDate,
        parent: z.string().optional(),
        collapsed: z.boolean().optional(),
        stages: z
          .array(
            z.object({
              id: z.string(),
              type: z.string(),
              start: isoDate,
              end: isoDate,
              people: z.array(z.string()).default([]),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
  milestones: z.array(z.object({ id: z.string(), date: isoDate, title: z.string() })).default([]),
  links: z.array(z.object({ id: z.string(), from: z.string(), to: z.string() })).default([]),
  people: z.enum(['inline', 'below']).optional(),
})

export type GanttContent = z.infer<typeof ganttSchema>

export function ganttDefaults(): GanttContent {
  const quarter = currentQuarter(today())
  return {
    start: formatDay(quarter.start),
    end: formatDay(quarter.end),
    scale: 'week',
    labelWidth: 160,
    rows: [],
    milestones: [],
    links: [],
  }
}
