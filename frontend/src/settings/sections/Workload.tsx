import { useQuery } from '@tanstack/react-query'
import { getWorkload, type Person, type StageType } from '@/api/planning'
import { formatSpan, parseDay, type Span } from '@/modules/gantt/timeline'
import { cn } from '@/lib/utils'
import { stageColors } from '@/planning/colors'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HATCH = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--card) 0 4px, var(--muted) 4px 8px)',
}

const span = (start: string, end: string): Span => ({ start: parseDay(start), end: parseDay(end) })

/** "Oct 12", with the month only where it changes. */
function weekLabel(iso: string, previous?: string) {
  const [, month, day] = iso.split('-').map(Number)
  const same = previous && Number(previous.split('-')[1]) === month
  return same ? String(day) : `${MONTHS[month - 1]} ${day}`
}

/** Twelve weeks of a person's stages on every board; read anew each time it opens. */
export function Workload({ person, types }: { person: Person; types: StageType[] }) {
  const workload = useQuery({
    queryKey: ['workload', person.id],
    queryFn: () => getWorkload(person.id),
    staleTime: 0,
  })
  if (workload.isPending) return <p className="text-muted-foreground text-[12px]">Loading…</p>
  if (workload.isError) {
    return <p className="text-destructive text-[12px]">The workload did not load.</p>
  }
  const { weeks, stages } = workload.data
  return (
    <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-2 text-[12px]">
      <ol aria-label={`Weeks of ${person.name}`} className="grid grid-cols-12 gap-1">
        {weeks.map((week, i) => (
          <li
            key={week.start}
            data-overlap={week.overlap || undefined}
            title={[
              `${week.stages} ${week.stages === 1 ? 'stage' : 'stages'}`,
              week.overlap && 'two stages on one day',
              week.off && `${person.name} is away`,
            ]
              .filter(Boolean)
              .join(' · ')}
            className="flex flex-col items-center gap-0.5"
          >
            <span className="text-muted-foreground text-[11px] whitespace-nowrap tabular-nums">
              {weekLabel(week.start, weeks[i - 1]?.start)}
            </span>
            <span
              className={cn(
                'bg-card grid h-6 w-full place-items-center rounded-[4px] border font-medium tabular-nums',
                week.stages === 0 && 'text-muted-foreground',
                week.overlap && 'border-destructive bg-destructive/10 text-destructive',
              )}
              style={week.off ? HATCH : undefined}
            >
              {week.stages}
            </span>
          </li>
        ))}
      </ol>
      {stages.length === 0 ? (
        <p className="text-muted-foreground">No stages in these weeks.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {stages.map((stage, i) => {
            const dates = formatSpan(span(stage.start, stage.end))
            if (!stage.board) {
              return (
                <li key={i} className="text-muted-foreground flex items-center gap-2">
                  <span className="bg-muted rounded-[4px] px-1.5 font-medium">Busy</span>
                  <span className="tabular-nums">{dates}</span>
                </li>
              )
            }
            const type = types.find((t) => t.id === stage.type)
            return (
              <li key={i}>
                <a
                  href={`/?board=${encodeURIComponent(stage.board)}`}
                  className="hover:bg-accent flex items-center gap-2 rounded-[4px] px-1 py-0.5"
                >
                  <span
                    className={cn(
                      'shrink-0 rounded-[4px] px-1.5 font-semibold',
                      !type && 'bg-card text-muted-foreground border',
                    )}
                    style={type && stageColors(type.hue)}
                  >
                    {type?.name ?? (stage.type ? 'Unknown' : 'No stage')}
                  </span>
                  <span className="min-w-0 truncate">
                    {stage.row || 'Untitled row'} ·{' '}
                    <span className="text-muted-foreground">{stage.boardName}</span>
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                    {dates}
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
