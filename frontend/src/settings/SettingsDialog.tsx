import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  ChartGantt,
  KeyRound,
  Link2,
  Plug,
  ShieldCheck,
  ListTodo,
  SlidersHorizontal,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { getAuthStatus, type Me } from '@/api/auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from 'cn'
import { MyTracker } from '@/settings/sections/MyTracker'
import { People } from '@/settings/sections/People'
import { Planning } from '@/settings/sections/Planning'
import { Preferences } from '@/settings/sections/Preferences'
import { Privacy } from '@/settings/sections/Privacy'
import { Profile } from '@/settings/sections/Profile'
import { Security } from '@/settings/sections/Security'
import { Sharing } from '@/settings/sections/Sharing'
import { TaskSource } from '@/settings/sections/TaskSource'
import { openSettings, useSettingsSection, type Section } from '@/settings/store'

type Entry = {
  id: Section
  label: string
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>
  render: (me: Me) => ReactNode
}

const VISITOR_HIDDEN = new Set<Section>(['profile', 'security', 'tracker', 'planning'])

const GROUPS: { title: string; admin: boolean; entries: Entry[] }[] = [
  {
    title: 'Account',
    admin: false,
    entries: [
      { id: 'profile', label: 'Profile', Icon: UserRound, render: (me) => <Profile me={me} /> },
      { id: 'security', label: 'Security', Icon: KeyRound, render: (me) => <Security me={me} /> },
      {
        id: 'preferences',
        label: 'Preferences',
        Icon: SlidersHorizontal,
        render: () => <Preferences />,
      },
      { id: 'tracker', label: 'My tracker', Icon: Plug, render: () => <MyTracker /> },
    ],
  },
  {
    title: 'Planning',
    admin: false,
    entries: [
      {
        id: 'planning',
        label: 'Stages and people',
        Icon: ChartGantt,
        render: (me) => <Planning me={me} />,
      },
    ],
  },
  {
    title: 'Instance',
    admin: true,
    entries: [
      { id: 'task-source', label: 'Task source', Icon: ListTodo, render: () => <TaskSource /> },
      { id: 'people', label: 'People', Icon: Users, render: (me) => <People me={me} /> },
      { id: 'sharing', label: 'Sharing', Icon: Link2, render: () => <Sharing /> },
      { id: 'privacy', label: 'Privacy', Icon: ShieldCheck, render: () => <Privacy /> },
    ],
  },
]

const NARROW = '(max-width: 719px)'

function useNarrow() {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(NARROW)
      query.addEventListener('change', listener)
      return () => query.removeEventListener('change', listener)
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  )
}

function Nav({
  groups,
  current,
  narrow,
  onPick,
}: {
  groups: typeof GROUPS
  current: Section
  narrow: boolean
  onPick: (id: Section) => void
}) {
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-0.5">
          <h3 className="text-muted-foreground px-2 pb-1 text-[12px] font-medium">{group.title}</h3>
          {group.entries.map(({ id, label, Icon }) => {
            const active = !narrow && id === current
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onPick(id)}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2 text-left text-[14px] outline-none',
                  'hover:bg-accent focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                  active && 'bg-accent font-medium',
                  narrow && 'h-11',
                )}
              >
                <Icon className="text-muted-foreground size-4" strokeWidth={1.75} />
                <span className="flex-1">{label}</span>
                {narrow && (
                  <ChevronRight className="text-muted-foreground size-4" strokeWidth={1.75} />
                )}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function SettingsBody({ me, section }: { me: Me; section: Section }) {
  const narrow = useNarrow()
  // On a narrow screen the window shows the list first, then one section with a Back button;
  // a link to another section opens it directly.
  const [listShown, setListShown] = useState(narrow && section === 'profile')
  const groups = GROUPS.filter((group) => !group.admin || me.role === 'admin').map((group) => ({
    ...group,
    // A demo visitor has no name, password or tracker of their own until they sign up.
    entries: group.entries.filter((item) => !me.demo_expires_at || !VISITOR_HIDDEN.has(item.id)),
  }))
  const entries = groups.flatMap((group) => group.entries)
  // A section the person cannot use, such as an admin one in a shared link, opens Profile.
  const entry = entries.find((item) => item.id === section) ?? entries[0]
  const pick = (id: Section) => {
    openSettings(id)
    setListShown(false)
  }

  if (narrow && listShown) {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <DialogTitle className="flex h-8 items-center text-[16px] font-semibold">
          Settings
        </DialogTitle>
        <Nav groups={groups} current={entry.id} narrow onPick={pick} />
      </div>
    )
  }

  return (
    <>
      {!narrow && (
        <aside className="bg-muted/40 flex w-52 shrink-0 flex-col gap-4 border-r px-3 pt-4 pb-3">
          <DialogTitle className="flex h-8 items-center px-2 text-[16px] font-semibold">
            Settings
          </DialogTitle>
          <Nav groups={groups} current={entry.id} narrow={false} onPick={pick} />
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {narrow && (
          <div className="flex h-16 shrink-0 items-center border-b px-2 pr-14">
            <Button variant="ghost" size="sm" onClick={() => setListShown(true)}>
              <ChevronLeft strokeWidth={1.75} />
              Settings
            </Button>
            <DialogTitle className="sr-only">Settings</DialogTitle>
          </div>
        )}
        {/* Equal side gutters wide enough for the close button, so actions end on one edge. */}
        <div className="w-full px-14 pt-4 pb-10 text-[14px] max-[719px]:px-4">
          {/* Keyed so a section's unsaved fields start fresh when the person changes. */}
          <div key={`${me.id}:${entry.id}`}>{entry.render(me)}</div>
        </div>
      </div>
    </>
  )
}

/** The settings window: sections on the left, the picked one on the right; over the board. */
export function SettingsDialog() {
  const section = useSettingsSection()
  const auth = useQuery({ queryKey: ['auth'], queryFn: getAuthStatus })
  const me = auth.data?.me
  return (
    <Dialog open={section !== null && !!me} onOpenChange={(open) => !open && openSettings(null)}>
      <DialogContent
        showCloseButton={false}
        // Focus stays on the window, so no ring lands on the first section on open.
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          'flex h-[min(640px,calc(100dvh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-[880px]',
          'max-[719px]:h-dvh max-[719px]:max-w-none max-[719px]:rounded-none',
        )}
      >
        <DialogClose asChild>
          <Button variant="ghost" size="icon" className="absolute top-4 right-4" aria-label="Close">
            <X strokeWidth={1.75} />
          </Button>
        </DialogClose>
        <DialogDescription className="sr-only">
          Your account, preferences and the settings of this tiko.
        </DialogDescription>
        {me && section && <SettingsBody me={me} section={section} />}
      </DialogContent>
    </Dialog>
  )
}
