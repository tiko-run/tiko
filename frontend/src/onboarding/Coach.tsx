import { Check, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import type { Item } from '@/api/onboarding'
import { Button } from '@/components/ui/button'
import { formatShortcut, type ShortcutId } from '@/lib/shortcuts'
import { onOnboardingDone } from '@/onboarding/done'

type Hint = {
  // A `data-tour` value; the hint moves on once that control opens or turns on.
  anchor?: string
  text: string
}

type Plan = {
  hints: Hint[]
  // Used when the first hint's control is not on screen.
  fallback?: Hint
}

const key = (id: ShortcutId) => formatShortcut(id)[0].join('')

const PLANS: Record<Exclude<Item, 'tracker'>, Plan> = {
  add_card: {
    hints: [
      { anchor: 'tool-card', text: `Click the task card button, or press ${key('card')}.` },
      { text: 'Type a task key like DEMO-5, a link or a JQL query, then press Enter.' },
    ],
  },
  paste_link: {
    hints: [
      {
        text: `Copy a task link or a key like DEMO-7, click an empty spot on the board and press ${key('paste')}.`,
      },
    ],
  },
  search_filter: {
    hints: [
      {
        text: `Press ${key('search')}, type status: and pick a status, then pick a result.`,
      },
    ],
  },
  set_timer: {
    hints: [
      { anchor: 'tool-timer', text: `Click the timer button, or press ${key('timer')}.` },
      { text: 'Now click a card. The timer sits next to it.' },
    ],
  },
  timer_list: {
    hints: [{ anchor: 'timer-list', text: 'Click here to see every timer on the board.' }],
    fallback: { anchor: 'main-menu', text: 'Open the main menu and pick Timers.' },
  },
  gantt_task: {
    hints: [
      { anchor: 'tool-module', text: `Click Modules, or press ${key('module')}.` },
      { text: 'Pick Gantt, then drag a card onto the chart.' },
    ],
  },
  focus: {
    hints: [{ anchor: 'focus-start', text: 'Press Start. You can pause any time.' }],
    fallback: {
      anchor: 'main-menu',
      text: 'Turn on Focus timer in the main menu, then press Start.',
    },
  },
}

// Long enough to read the check and see the confetti land before the hint goes.
const DONE_MS = 1600
const CONFETTI_COLORS = [
  'var(--primary)',
  'var(--timer)',
  'var(--status-done-foreground)',
  'var(--status-progress-foreground)',
  'var(--destructive)',
  'var(--sync-ok)',
]
const GAP = 12
const WIDTH = 288

function find(anchor?: string) {
  return anchor ? document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`) : null
}

function hintsFor(item: Exclude<Item, 'tracker'>): Hint[] {
  const plan = PLANS[item]
  return plan.fallback && !find(plan.hints[0].anchor) ? [plan.fallback] : plan.hints
}

function place(target: HTMLElement | null): CSSProperties {
  // Without a control to point at, the hint sits just above About, in sight but clear of the
  // board's middle where the person clicks and of the toolbar's popovers.
  if (!target) return { bottom: 72, left: 16 }
  const box = target.getBoundingClientRect()
  const left = Math.min(
    Math.max(box.left + box.width / 2 - WIDTH / 2, 16),
    window.innerWidth - WIDTH - 16,
  )
  return box.top > window.innerHeight / 2
    ? { bottom: window.innerHeight - box.top + GAP, left }
    : { top: box.bottom + GAP, left }
}

// A small burst from the check: fixed angles and colors, so every success looks the same.
const BITS = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * 2 * Math.PI - Math.PI / 2
  const reach = 26 + (i % 3) * 9
  return {
    x: Math.round(Math.cos(angle) * reach),
    y: Math.round(Math.sin(angle) * reach),
    turn: (i * 47) % 360,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: (i % 4) * 30,
  }
})

function Confetti() {
  return (
    <span aria-hidden className="coach-confetti">
      {BITS.map((bit, i) => (
        <i
          key={i}
          style={
            {
              '--x': `${bit.x}px`,
              '--y': `${bit.y}px`,
              '--turn': `${bit.turn}deg`,
              background: bit.color,
              animationDelay: `${bit.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}

/** Walks the person through doing one getting started item on the live board. */
export default function Coach({
  item,
  onClose,
}: {
  item: Exclude<Item, 'tracker'>
  onClose: () => void
}) {
  const [hints] = useState(() => hintsFor(item))
  const [at, setAt] = useState(0)
  const [done, setDone] = useState(false)
  const hint = hints[at]
  const target = find(hint.anchor)
  const [style, setStyle] = useState<CSSProperties>(() => place(target))

  useLayoutEffect(() => {
    const update = () => setStyle(place(target))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [target])

  // The control stays usable: a ring marks it, and opening or turning it on moves the hint on.
  useEffect(() => {
    if (!target || done) return
    target.classList.add('coach-target')
    const moved = () =>
      target.getAttribute('aria-expanded') === 'true' ||
      target.getAttribute('aria-pressed') === 'true'
    const watch = new MutationObserver(() => {
      if (moved() && at < hints.length - 1) setAt(at + 1)
    })
    watch.observe(target, { attributes: true, attributeFilter: ['aria-expanded', 'aria-pressed'] })
    return () => {
      watch.disconnect()
      target.classList.remove('coach-target')
    }
  }, [target, done, at, hints.length])

  useEffect(() => onOnboardingDone((doneItem) => doneItem === item && setDone(true)), [item])

  useEffect(() => {
    if (!done) return
    const timer = setTimeout(onClose, DONE_MS)
    return () => clearTimeout(timer)
  }, [done, onClose])

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 fixed z-50 flex items-start gap-2 rounded-lg border p-3 text-[13px] shadow-md motion-reduce:animate-none"
      style={{ ...style, width: WIDTH }}
    >
      {done ? (
        <>
          <span className="relative mt-0.5 size-4 shrink-0">
            <Check className="text-primary size-4" strokeWidth={2} aria-hidden />
            <Confetti />
          </span>
          <span className="flex-1 font-medium">Done</span>
        </>
      ) : (
        <>
          <span className="flex-1 leading-normal">{hint.text}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground -mt-1 -mr-1"
            aria-label="Stop showing"
            onClick={onClose}
          >
            <X />
          </Button>
        </>
      )}
    </div>
  )
}
