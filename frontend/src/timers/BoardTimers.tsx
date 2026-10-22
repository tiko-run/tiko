import type { ReactNode } from 'react'
import type { Task } from '@/api/tasks'
import type { AppNode, TimerData } from '@/canvas/types'
import { useNow } from './clock'
import { useTimerPanelOpen } from './panel'
import { finish, snooze } from './timer'
import { TimerButton, TimerPanel } from './TimerList'
import { TimerNotes } from './TimerNotes'
import { useTimers } from './useTimers'
import { topOverlay } from '@/lib/overlays'

type Props = {
  nodes: AppNode[]
  tasks: Record<string, Task>
  onOpen: (id: string) => void
  onChange: (id: string, change: (data: TimerData) => TimerData) => void
  /** Sits right of the timer button in the top right row: the sync indicator. */
  children: ReactNode
}

// Its own component, so the once-a-second tick re-renders only the timer UI, not the board.
export function BoardTimers({ nodes, tasks, onOpen, onChange, children }: Props) {
  const now = useNow()
  const { timers, fired, missed, dismissMissed } = useTimers(nodes, { tasks, onOpen, onChange })
  const panelOpen = useTimerPanelOpen()
  const onDone = (id: string) => onChange(id, (data) => finish(data, Date.now()))
  const onSnooze = (id: string, ms: number) => onChange(id, (data) => snooze(data, ms, Date.now()))

  return (
    <>
      <div ref={topOverlay} className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <TimerButton timers={timers} now={now} />
        {children}
      </div>
      {panelOpen ? (
        <TimerPanel timers={timers} now={now} onOpen={onOpen} onDone={onDone} onSnooze={onSnooze} />
      ) : (
        <TimerNotes
          fired={fired}
          missed={missed}
          onDismissMissed={dismissMissed}
          onOpen={onOpen}
          onDone={onDone}
          onSnooze={onSnooze}
        />
      )}
    </>
  )
}
