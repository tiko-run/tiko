import { ChartGantt } from 'lucide-react'
import { GanttControls, GanttModule } from '@/modules/gantt/GanttModule'
import { acceptCard, bodyHeight, rowTask } from '@/modules/gantt/rows'
import { ganttDefaults, ganttSchema } from '@/modules/gantt/schema'
import { defineModule } from '@/modules/types'

export const gantt = defineModule({
  kind: 'gantt',
  name: 'Gantt',
  description: 'Plan live tasks on a timeline with quarters, months and weeks.',
  Icon: ChartGantt,
  size: { width: 960, height: 320 },
  minSize: { width: 480, height: 200 },
  minHeight: bodyHeight,
  expandable: true,
  defaults: ganttDefaults,
  schema: ganttSchema,
  keys: (content) => content.rows.flatMap((row) => rowTask(row) ?? []),
  View: GanttModule,
  Controls: GanttControls,
  acceptCard,
  searchable: (content) => [
    ...content.rows.map((row) => ({
      kind: 'row' as const,
      key: row.key,
      source: row.source,
      text: row.title,
    })),
    ...content.milestones.map((m) => ({ kind: 'milestone' as const, text: m.title })),
  ],
})
