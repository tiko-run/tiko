import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownWideNarrow,
  Copy,
  Globe,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  SquareArrowOutUpRight,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getAuthStatus } from '@/api/auth'
import { canEdit, type BoardSummary } from '@/api/boards'
import { DeleteBoardDialog, RenameBoardForm } from '@/board/BoardActions'
import { ShareDialog } from '@/board/ShareDialog'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { boardHref, goTo } from '@/lib/navigation'
import { formatShortcut, useShortcut } from '@/lib/shortcuts'
import { relativeTime } from '@/lib/time'
import { useFlip } from '@/lib/useFlip'
import { cn } from 'cn'
import { useDuplicateBoard, useNewBoard } from './actions'
import { readView, saveView, visibleBoards, type Filter, type Sort } from './list'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'shared', label: 'Shared with me' },
]

const SORTS: { value: Sort; label: string }[] = [
  { value: 'updated', label: 'Last change' },
  { value: 'name', label: 'Name' },
]

type Props = {
  boards: BoardSummary[]
  /** Admins only: boards nobody shared with them. */
  others: BoardSummary[]
}

/** Where tiko lands without a board in the address: every board the person can open. */
export function Home({ boards, others }: Props) {
  const me = useQuery({ queryKey: ['auth'], queryFn: getAuthStatus }).data?.me
  const demo = !!me?.demo_expires_at
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>(() => readView().sort)
  const [selected, setSelected] = useState(0)
  // The keyboard pick shows only while the search field drives it.
  const [searching, setSearching] = useState(false)
  // An empty field picks nothing until an arrow key is pressed.
  const [steering, setSteering] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [sharing, setSharing] = useState<BoardSummary | null>(null)
  const [deleting, setDeleting] = useState<BoardSummary | null>(null)
  // One right-click menu for the whole list: a menu per row costs too much with hundreds of boards.
  const [pointed, setPointed] = useState<BoardSummary | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const newBoard = useNewBoard()
  const duplicate = useDuplicateBoard()

  useShortcut('findBoard', () => search.current?.focus())

  // Boards change while one is open, so Home reads the list again each time it shows.
  const queryClient = useQueryClient()
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['boards'] })
  }, [queryClient])

  const data = useMemo(() => ({ boards, others }), [boards, others])
  useFlip(list, data, `${filter}|${query}|${sort}`)

  const options = { filter, query, sort, me: me?.id }
  const shown = visibleBoards(boards, options)
  // Boards of others are nobody's own and nobody shared them: only "All" has them.
  const shownOthers = filter === 'all' ? visibleBoards(others, options) : []
  const flat = [...shown, ...shownOthers]
  const current = Math.min(selected, flat.length - 1)

  useEffect(() => {
    list.current?.querySelector('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const changeSort = (value: Sort) => {
    setSort(value)
    saveView({ sort: value })
  }

  const picking = searching && (steering || query.trim() !== '')

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setSelected(picking ? Math.max(0, Math.min(flat.length - 1, current + step)) : 0)
      setSteering(true)
    } else if (event.key === 'Enter' && picking && flat[current]) {
      goTo(flat[current].id)
    } else if (event.key === 'Escape' && query) {
      event.preventDefault()
      setQuery('')
    }
  }

  // Stable, so a row redraws only when its own board or state changes.
  const { mutate: duplicateBoard } = duplicate
  const menu = useMemo<Menu>(
    () => ({
      rename: setRenaming,
      renamed: () => setRenaming(null),
      duplicate: duplicateBoard,
      share: setSharing,
      remove: setDeleting,
      point: setPointed,
    }),
    [duplicateBoard],
  )

  const rows = (items: BoardSummary[], offset: number) => (
    <ul className="divide-y rounded-lg border">
      {items.map((board, index) => (
        <BoardRow
          key={board.id}
          board={board}
          own={board.owner?.id === me?.id}
          demo={demo}
          selected={picking && offset + index === current}
          renaming={renaming === board.id}
          menu={menu}
        />
      ))}
    </ul>
  )

  const filtered = query.trim() !== '' || filter !== 'all'

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 pt-32 pb-24 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[20px] font-semibold tracking-[-0.01em]">Boards</h2>
          <Button size="sm" onClick={() => newBoard.mutate()} disabled={newBoard.isPending}>
            <Plus strokeWidth={1.75} />
            New board
          </Button>
        </div>

        {boards.length === 0 && others.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
            <p className="text-[14px]">No boards yet. Make one to start placing tasks on it.</p>
            <Button size="sm" onClick={() => newBoard.mutate()} disabled={newBoard.isPending}>
              <Plus strokeWidth={1.75} />
              New board
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={filter}
                onValueChange={(value) => value && setFilter(value as Filter)}
                aria-label="Show boards"
              >
                {FILTERS.map(({ value, label }) => (
                  <ToggleGroupItem key={value} value={value} className="px-3 text-[13px]">
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className="relative min-w-48 flex-1">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                  strokeWidth={1.75}
                />
                <label htmlFor="home-search" className="sr-only">
                  Find a board
                </label>
                <Input
                  id="home-search"
                  ref={search}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setSelected(0)
                  }}
                  onKeyDown={onSearchKey}
                  onFocus={() => setSearching(true)}
                  onBlur={() => {
                    setSearching(false)
                    setSteering(false)
                  }}
                  placeholder="Find a board"
                  className="h-8 pr-10 pl-8"
                  autoComplete="off"
                />
                <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">
                  {formatShortcut('findBoard')[0].join('')}
                </Kbd>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-[13px] font-normal">
                    <ArrowDownWideNarrow strokeWidth={1.75} />
                    {SORTS.find((item) => item.value === sort)?.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-muted-foreground text-[12px] font-medium">
                    Sort by
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={sort}
                    onValueChange={(value) => changeSort(value as Sort)}
                  >
                    {SORTS.map(({ value, label }) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  ref={list}
                  className="flex flex-col gap-6"
                  onContextMenuCapture={() => setPointed(null)}
                >
                  {shown.length > 0 && rows(shown, 0)}
                  {shownOthers.length > 0 && (
                    <section className="flex flex-col gap-2" aria-label="Other boards">
                      <h3 className="text-muted-foreground text-[12px] font-medium">
                        Other boards in this workspace
                      </h3>
                      {rows(shownOthers, shown.length)}
                    </section>
                  )}
                  {flat.length === 0 && (
                    <p className="text-muted-foreground py-8 text-center text-[14px]">
                      {query.trim()
                        ? `No boards match "${query.trim()}".`
                        : filter === 'mine'
                          ? 'You own no boards yet.'
                          : 'Nobody has shared a board with you yet.'}
                    </p>
                  )}
                </div>
              </ContextMenuTrigger>
              {pointed && (
                <ContextMenuContent className="w-44">
                  <MenuItems kind="context" actions={actionsFor(pointed, demo, menu)} />
                </ContextMenuContent>
              )}
            </ContextMenu>
            {filtered && flat.length > 0 && (
              <p className="text-muted-foreground text-[12px]">
                {flat.length} of {boards.length + others.length} boards
              </p>
            )}
          </>
        )}
      </div>
      {sharing && (
        <ShareDialog board={sharing} open onOpenChange={(open) => !open && setSharing(null)} />
      )}
      <DeleteBoardDialog board={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
    </div>
  )
}

type Action = { label: string; Icon: LucideIcon; run: () => void; destructive?: boolean }

type Menu = {
  rename: (id: string) => void
  renamed: () => void
  duplicate: (board: BoardSummary) => void
  share: (board: BoardSummary) => void
  remove: (board: BoardSummary) => void
  point: (board: BoardSummary) => void
}

function actionsFor(board: BoardSummary, demo: boolean, menu: Menu): Action[] {
  return [
    { label: 'Open', Icon: SquareArrowOutUpRight, run: () => goTo(board.id) },
    ...(canEdit(board.my_role)
      ? [{ label: 'Rename', Icon: Pencil, run: () => menu.rename(board.id) }]
      : []),
    { label: 'Duplicate', Icon: Copy, run: () => menu.duplicate(board) },
    ...(demo ? [] : [{ label: 'Share', Icon: Share2, run: () => menu.share(board) }]),
    ...(board.my_role === 'owner'
      ? [{ label: 'Delete…', Icon: Trash2, run: () => menu.remove(board), destructive: true }]
      : []),
  ]
}

type RowProps = {
  board: BoardSummary
  own: boolean
  demo: boolean
  selected: boolean
  renaming: boolean
  menu: Menu
}

const BoardRow = memo(function BoardRow({ board, own, demo, selected, renaming, menu }: RowProps) {
  const edited = relativeTime(board.updated_at)
  return (
    <li
      data-flip={board.id}
      data-selected={selected}
      onContextMenu={() => menu.point(board)}
      className={cn(
        'group hover:bg-accent/60 grid h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 first:rounded-t-lg last:rounded-b-lg sm:grid-cols-[minmax(0,1fr)_160px_168px_auto]',
        selected && 'bg-accent',
      )}
    >
      {renaming ? (
        <RenameBoardForm board={board} onDone={menu.renamed} />
      ) : (
        <a
          href={boardHref(board.id)}
          onClick={(event) => {
            // A new tab or window keeps the browser's own way.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
            event.preventDefault()
            goTo(board.id)
          }}
          className="flex min-w-0 items-center gap-2 rounded-sm text-[14px] outline-none focus-visible:underline"
        >
          <LayoutDashboard className="text-muted-foreground size-4 shrink-0" strokeWidth={1.75} />
          <span className="truncate font-medium">{board.name}</span>
          {board.public && (
            <Globe
              className="text-muted-foreground size-3.5 shrink-0"
              strokeWidth={1.75}
              aria-label="Public link on"
            />
          )}
          {board.my_role === 'viewer' && (
            <span className="text-muted-foreground shrink-0 text-[12px]">View only</span>
          )}
        </a>
      )}
      <span className="text-muted-foreground hidden truncate text-[13px] sm:block">
        {own ? 'You' : board.owner?.name}
      </span>
      <span className="text-muted-foreground hidden truncate text-[12px] whitespace-nowrap tabular-nums sm:block">
        {edited && `Edited ${edited}`}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0"
            aria-label={`Actions for ${board.name}`}
          >
            <MoreHorizontal strokeWidth={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <MenuItems kind="dropdown" actions={actionsFor(board, demo, menu)} />
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
})

function MenuItems({ kind, actions }: { kind: 'dropdown' | 'context'; actions: Action[] }) {
  const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem
  const Separator = kind === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator
  return actions.map(({ label, Icon, run, destructive }) => (
    <Fragment key={label}>
      {destructive && <Separator />}
      <Item variant={destructive ? 'destructive' : 'default'} onSelect={run}>
        <Icon strokeWidth={1.75} />
        {label}
      </Item>
    </Fragment>
  ))
}
