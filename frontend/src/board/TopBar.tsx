import {
  ChevronDown,
  Globe,
  House,
  Keyboard,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Pencil,
  Plus,
  Search,
  Share2,
  Settings,
  SquareChevronRight,
  AlarmClock,
  Sun,
  SunMoon,
  Timer,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { getAuthStatus, signOut } from '@/api/auth'
import { canEdit, type BoardSummary } from '@/api/boards'
import { RenameBoardForm, TrashBoardDialog } from '@/board/BoardActions'
import { DemoMark } from '@/board/DemoMark'
import { SignUpDialog } from '@/auth/SignUp'
import { ShareDialog } from '@/board/ShareDialog'
import { Faces } from '@/live/Avatar'
import { useBoardPeople } from '@/live/presence'
import { ShortcutsDialog } from '@/board/ShortcutsDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setFocusVisible, useFocusVisible } from '@/focus/store'
import { useCommands } from '@/search/commands'
import { COMMANDS_PREFIX, setSearchOpen } from '@/search/palette'
import { setTimerPanelOpen } from '@/timers/panel'
import { formatShortcut, useShortcut } from '@/lib/shortcuts'
import { useTheme, type Theme } from '@/lib/theme'
import { openSettings } from '@/settings/store'
import { useNewBoard } from '@/home/actions'
import { clearRename, goTo } from '@/lib/navigation'
import { topOverlay } from '@/lib/overlays'

// Boards owned by someone else name the owner, so shared ones stand apart from your own.
function BoardItem({ board }: { board: BoardSummary }) {
  const me = useQuery({ queryKey: ['auth'], queryFn: getAuthStatus }).data?.me
  const foreign = me && board.owner && board.owner.id !== me.id
  return (
    <DropdownMenuRadioItem value={board.id} className="min-w-0">
      <span className="min-w-0 truncate">{board.name}</span>
      {board.public && (
        <Globe className="text-muted-foreground size-3.5 shrink-0" strokeWidth={1.75} />
      )}
      {foreign && (
        <span className="text-muted-foreground ml-auto max-w-24 shrink-0 truncate pl-3 text-[12px]">
          {board.owner?.name}
        </span>
      )}
    </DropdownMenuRadioItem>
  )
}

const themes = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const

type Props = {
  boards: BoardSummary[]
  /** Admins only: boards nobody shared with them. */
  others?: BoardSummary[]
  current?: BoardSummary
  /** The board was just made: its name opens for typing. */
  renameOnOpen?: boolean
}

export function TopBar({ boards, others = [], current, renameOnOpen = false }: Props) {
  const { theme, setTheme } = useTheme()
  const focusVisible = useFocusVisible()
  const newBoard = useNewBoard()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [sharing, setSharing] = useState(false)
  const people = useBoardPeople()
  const [deleting, setDeleting] = useState<BoardSummary | null>(null)

  useEffect(() => {
    if (!renameOnOpen || !current) return
    if (canEdit(current.my_role)) setRenaming(true)
    clearRename()
  }, [renameOnOpen, current])

  const me = useQuery({ queryKey: ['auth'], queryFn: getAuthStatus }).data?.me
  // A demo visitor has no account yet: nothing to share with, no password to come back by.
  const demoUntil = me?.demo_expires_at
  const [leaving, setLeaving] = useState(false)
  const [signingUp, setSigningUp] = useState(false)
  // A reload drops every cached board and task along with the session.
  const logout = useMutation({ mutationFn: signOut, onSuccess: () => window.location.reload() })

  useShortcut('help', () => setShortcutsOpen(true))
  useShortcut('settings', () => openSettings())
  useCommands([
    ...(current
      ? [
          {
            id: 'app:timers',
            title: 'Show reminders',
            group: 'Commands' as const,
            Icon: AlarmClock,
            keywords: 'timers alarms',
            run: () => setTimerPanelOpen(true),
          },
        ]
      : []),
    {
      id: 'app:focus',
      title: focusVisible ? 'Hide focus timer' : 'Show focus timer',
      group: 'Commands',
      Icon: Timer,
      keywords: 'pomodoro music lofi',
      run: () => setFocusVisible(!focusVisible),
    },
    ...themes.map(({ value, label, Icon }) => ({
      id: `app:theme:${value}`,
      title: `Switch to ${label.toLowerCase()} theme`,
      group: 'Commands' as const,
      Icon,
      keywords: 'appearance mode',
      run: () => setTheme(value),
    })),
    {
      id: 'app:shortcuts',
      title: 'Keyboard shortcuts',
      group: 'Commands',
      Icon: Keyboard,
      shortcut: 'help',
      keywords: 'hotkeys keys help',
      run: () => setShortcutsOpen(true),
    },
    {
      id: 'app:settings',
      title: 'Open settings',
      group: 'Commands',
      Icon: Settings,
      shortcut: 'settings',
      keywords: 'jira token connection preferences profile account',
      run: () => openSettings(),
    },
    ...(demoUntil
      ? []
      : [
          {
            id: 'app:password',
            title: 'Change password',
            group: 'Commands' as const,
            Icon: KeyRound,
            keywords: 'security account',
            run: () => openSettings('security'),
          },
        ]),
    ...(current && !demoUntil
      ? [
          {
            id: 'app:share-board',
            title: 'Share board',
            group: 'Commands' as const,
            Icon: Share2,
            keywords: 'access people members invite',
            run: () => setSharing(true),
          },
        ]
      : []),
    {
      id: 'app:new-board',
      title: 'New board',
      group: 'Commands',
      Icon: Plus,
      keywords: 'create add',
      run: () => newBoard.mutate(),
    },
    ...(current
      ? [
          {
            id: 'app:home',
            title: 'Go to Home',
            group: 'Commands' as const,
            Icon: House,
            keywords: 'all boards list',
            run: () => goTo(null),
          },
        ]
      : []),
    ...(current && canEdit(current.my_role)
      ? [
          {
            id: 'app:rename-board',
            title: 'Rename board',
            group: 'Commands' as const,
            Icon: Pencil,
            run: () => setRenaming(true),
          },
        ]
      : []),
    ...[...boards, ...others]
      .filter((board) => board.id !== current?.id)
      .map((board) => ({
        id: `board:${board.id}`,
        title: `Go to board ${board.name}`,
        group: 'Boards' as const,
        Icon: LayoutDashboard,
        keywords: 'open switch',
        run: () => goTo(board.id),
      })),
  ])

  return (
    <div
      ref={topOverlay}
      className="bg-card absolute top-4 left-4 z-10 flex items-center gap-1 rounded-lg border p-1 shadow-md"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Main menu" data-tour="main-menu">
            <Menu className="size-[18px]" strokeWidth={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {me && (
            <>
              <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
                <span className="truncate font-medium">{me.name}</span>
                {!demoUntil && (
                  <span className="text-muted-foreground truncate text-[12px]">{me.username}</span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          {current && (
            <DropdownMenuItem onSelect={() => setSearchOpen(true)}>
              <Search strokeWidth={1.75} />
              Search
              <DropdownMenuShortcut>{formatShortcut('search')[0]}</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          {current && (
            <DropdownMenuItem onSelect={() => setSearchOpen(true, COMMANDS_PREFIX)}>
              <SquareChevronRight strokeWidth={1.75} />
              Commands
              <DropdownMenuShortcut>{formatShortcut('commands')[0]}</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => openSettings()}>
            <Settings strokeWidth={1.75} />
            Settings
            <DropdownMenuShortcut>{formatShortcut('settings')[0]}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
            <Keyboard strokeWidth={1.75} />
            Keyboard shortcuts
            <DropdownMenuShortcut>{formatShortcut('help')[0]}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SunMoon strokeWidth={1.75} />
              Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => setTheme(value as Theme)}
              >
                {themes.map(({ value, label, Icon }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <Icon strokeWidth={1.75} />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {current && (
            <DropdownMenuItem onSelect={() => setTimerPanelOpen(true)}>
              <AlarmClock strokeWidth={1.75} />
              Reminders
            </DropdownMenuItem>
          )}
          <DropdownMenuCheckboxItem checked={focusVisible} onCheckedChange={setFocusVisible}>
            <Timer strokeWidth={1.75} />
            Focus timer
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => (demoUntil ? setLeaving(true) : logout.mutate())}
            disabled={logout.isPending}
          >
            <LogOut strokeWidth={1.75} />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <TrashBoardDialog board={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Leave the demo?</DialogTitle>
            <DialogDescription>
              Without an account your boards cannot be opened again after you sign out. They are
              deleted in a week. Sign up first to keep them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaving(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {current && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Home"
          title="Home"
          onClick={() => goTo(null)}
        >
          <House className="size-[18px]" strokeWidth={1.75} />
        </Button>
      )}
      {renaming && current ? (
        <RenameBoardForm board={current} onDone={() => setRenaming(false)} />
      ) : (
        current && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="max-w-64 text-[14px] font-normal">
                <span className="truncate">{current.name}</span>
                <ChevronDown strokeWidth={1.75} data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuRadioGroup
                value={current.id}
                onValueChange={(id) => goTo(id)}
                className="max-h-80 overflow-x-hidden overflow-y-auto"
              >
                {boards.map((board) => (
                  <BoardItem key={board.id} board={board} />
                ))}
                {others.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-muted-foreground text-[12px] font-medium">
                      Other boards
                    </DropdownMenuLabel>
                    {others.map((board) => (
                      <BoardItem key={board.id} board={board} />
                    ))}
                  </>
                )}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => goTo(null)}>
                <LayoutGrid strokeWidth={1.75} />
                All boards
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => newBoard.mutate()} disabled={newBoard.isPending}>
                <Plus strokeWidth={1.75} />
                New board
              </DropdownMenuItem>
              {canEdit(current.my_role) && (
                <DropdownMenuItem onSelect={() => setRenaming(true)}>
                  <Pencil strokeWidth={1.75} />
                  Rename board
                </DropdownMenuItem>
              )}
              {current.my_role === 'owner' && (
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(current)}>
                  <Trash2 strokeWidth={1.75} />
                  Move to trash…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      )}
      {current && current.my_role === 'viewer' && (
        <Badge variant="outline" className="text-muted-foreground mx-1">
          View only
        </Badge>
      )}
      {current?.public && (
        <Badge variant="outline" className="text-muted-foreground mx-1">
          Public
        </Badge>
      )}
      {demoUntil && (
        <>
          <DemoMark expiresAt={demoUntil} />
          <Button
            variant="ghost"
            size="sm"
            className="text-[14px] font-normal"
            onClick={() => setSigningUp(true)}
          >
            <UserPlus strokeWidth={1.75} />
            Sign up to keep it
          </Button>
        </>
      )}
      <SignUpDialog open={signingUp} onOpenChange={setSigningUp} />
      {current && !demoUntil && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="text-[14px] font-normal"
            onClick={() => setSharing(true)}
          >
            <Share2 strokeWidth={1.75} />
            Share
          </Button>
          <ShareDialog board={current} open={sharing} onOpenChange={setSharing} />
          <Faces people={people} />
        </>
      )}
    </div>
  )
}
