import { driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import '@/onboarding/tour.css'
import { formatShortcut, type ShortcutId } from '@/lib/shortcuts'
import { LOOPS } from '@/onboarding/loops'

export type StepId = 'welcome' | 'add' | 'search' | 'timer' | 'gantt' | 'focus' | 'arrange'

type Step = {
  id: StepId
  // A `data-tour` value; without one, or when it is not on screen, the step is centered.
  anchor?: string
  title: string
  text: string
}

const key = (id: ShortcutId) => `<kbd>${formatShortcut(id)[0].join('')}</kbd>`

export const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to tiko',
    text: 'Cards on this board are live: their status comes from your tracker and refreshes by itself. A quick look around.',
  },
  {
    id: 'add',
    anchor: 'tool-card',
    title: 'Add tasks',
    text: `Type a key like DEMO-12 or a JQL query, or paste a task link anywhere on the board. ${key('card')}`,
  },
  {
    id: 'search',
    title: 'Find anything',
    text: `${key('search')} searches cards, notes and timers. Narrow it with <code>status:</code>, <code>@name</code>, <code>type:</code> or <code>priority:</code>. ${key('commands')} runs commands.`,
  },
  {
    id: 'timer',
    anchor: 'tool-timer',
    title: 'Set a reminder',
    text: `Put a timer by a card: it goes off after a while or on a status change. All timers are listed top right. ${key('timer')}`,
  },
  {
    id: 'gantt',
    anchor: 'tool-module',
    title: 'Plan on a Gantt',
    text: `Add a Gantt chart from Modules and drag cards onto it. Bars keep the live status. ${key('module')}`,
  },
  {
    id: 'focus',
    anchor: 'focus',
    title: 'Focus with music',
    text: 'A pomodoro timer with music. Start a session, skip a track or add your own.',
  },
  {
    id: 'arrange',
    anchor: 'about',
    title: 'Arrange it your way',
    text: `Group cards with frames, notes and arrows. ${key('help')} shows every shortcut. Run this tour again from About.`,
  },
]

export function driveSteps(only?: StepId, root: ParentNode = document): DriveStep[] {
  return STEPS.filter((step) => !only || step.id === only).map((step) => {
    const element = step.anchor
      ? (root.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`) ?? undefined)
      : undefined
    return {
      element,
      popover: {
        title: step.title,
        description: `<div class="tour-loop" aria-hidden="true">${LOOPS[step.id]}</div><p>${step.text}</p>`,
      },
    }
  })
}

/** Runs the whole tour, or one step; `onEnd` runs however it ends. */
export function runTour(only?: StepId, onEnd?: () => void) {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const tour = driver({
    steps: driveSteps(only),
    animate: !still,
    smoothScroll: false,
    allowClose: true,
    overlayOpacity: 0.45,
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: 'tour-popover',
    popoverOffset: 12,
    showProgress: !only,
    progressText: '{{current}} of {{total}}',
    showButtons: only ? ['close'] : ['next', 'previous', 'close'],
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: only ? 'Got it' : 'Done',
    onDestroyed: () => onEnd?.(),
  })
  tour.drive()
  return tour
}
