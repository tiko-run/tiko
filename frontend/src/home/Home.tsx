import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownWideNarrow,
  Check,
  Copy,
  FolderInput,
  Globe,
  LayoutDashboard,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  SquareArrowOutUpRight,
  Star,
  StarOff,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { getAuthStatus } from '@/api/auth'
import { canEdit, previewUrl, type BoardSummary } from '@/api/boards'
import type { Folder } from '@/api/folders'
import { RenameBoardForm, TrashBoardDialog } from '@/board/BoardActions'
import { ShareDialog } from '@/board/ShareDialog'
import { restoreFocusForKeyboard } from '@/lib/input-modality'
import { releaseTourHolds } from '@/onboarding/start'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import {
  inPlace,
  readView,
  saveView,
  visibleBoards,
  type Filter,
  type Layout,
  type Place,
  type Sort,
} from './list'
import { useFolders, usePlace, useStar, useTrash } from './organize'
import { BOARD_DRAG, Side, type Counts } from './Side'
import { Trash } from './Trash'
import { Scroller } from '@/components/Scroller'

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
  const [place, setPlace] = useState<Place>('all')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>(() => readView().sort)
  // Back on Home, a board made earlier is no longer new: the tour may start on it.
  useEffect(() => releaseTourHolds(), [])
  const [layout, setLayout] = useState<Layout>(() => readView().layout)
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
  // A rename picked in a menu waits for the menu to close: its focus trap would take the field's focus.
  const renameNext = useRef<string | null>(null)
  const newBoard = useNewBoard()
  const duplicate = useDuplicateBoard()
  const star = useStar()
  const placeBoard = usePlace()
  const folders = useFolders()
  const folder = typeof place === 'object' ? folders.find((f) => f.id === place.folder) : undefined
  const trashed = useTrash().data?.boards.length ?? 0

  useShortcut('findBoard', () => search.current?.focus())

  // Boards change while one is open, so Home reads the list again each time it shows.
  const queryClient = useQueryClient()
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['boards'] })
  }, [queryClient])

  const data = useMemo(() => ({ boards, others }), [boards, others])
  useFlip(list, data, `${JSON.stringify(place)}|${filter}|${query}|${sort}`)

  const here = boards.filter((board) => inPlace(board, place))
  const othersHere = others.filter((board) => inPlace(board, place))
  const options = { filter, query, sort, me: me?.id }
  const shown = visibleBoards(here, options)
  // Boards of others are nobody's own and nobody shared them: only "All" has them.
  const shownOthers = filter === 'all' ? visibleBoards(othersHere, options) : []
  const flat = [...shown, ...shownOthers]
  const current = Math.min(selected, flat.length - 1)

  useEffect(() => {
    list.current?.querySelector('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const changeSort = (value: Sort) => {
    setSort(value)
    saveView({ sort: value, layout })
  }

  const changeLayout = (value: Layout) => {
    setLayout(value)
    saveView({ sort, layout: value })
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
  const { mutate: starBoard } = star
  const { mutate: moveBoard } = placeBoard
  const menu = useMemo<Menu>(
    () => ({
      rename: (id) => {
        renameNext.current = id
      },
      closed: (event) => {
        const id = renameNext.current
        if (id === null) return false
        renameNext.current = null
        event.preventDefault()
        setRenaming(id)
        return true
      },
      renamed: () => setRenaming(null),
      duplicate: duplicateBoard,
      share: setSharing,
      remove: setDeleting,
      point: setPointed,
      star: (board, starred) => starBoard({ id: board.id, starred }),
      move: (board, folderId) => moveBoard({ id: board.id, folderId }),
    }),
    [duplicateBoard, starBoard, moveBoard],
  )

  const all = [...boards, ...others]
  const dropBoard = (target: Place, id: string) => {
    const board = all.find((item) => item.id === id)
    if (!board) return
    if (target === 'starred') {
      if (!board.starred) menu.star(board, true)
    } else if (target === 'trash') {
      if (board.my_role === 'owner') menu.remove(board)
    } else {
      const folderId = target === 'all' ? null : target.folder
      if ((board.folder_id ?? null) !== folderId) menu.move(board, folderId)
    }
  }
  const sideCounts: Counts = {
    all: all.length,
    starred: all.filter((board) => board.starred).length,
    trash: trashed,
    folders: Object.fromEntries(
      folders.map((f) => [f.id, all.filter((board) => board.folder_id === f.id).length]),
    ),
  }
  const changePlace = (value: Place) => {
    setPlace(value)
    setSelected(0)
  }
  const title =
    place === 'starred' ? 'Starred' : place === 'trash' ? 'Trash' : (folder?.name ?? 'Boards')

  const Item = layout === 'grid' ? BoardCard : BoardRow
  const rows = (items: BoardSummary[], offset: number) => (
    <ul
      className={
        layout === 'grid'
          ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3'
          : 'divide-y rounded-lg border'
      }
    >
      {items.map((board, index) => (
        <Item
          key={board.id}
          board={board}
          own={board.owner?.id === me?.id}
          demo={demo}
          selected={picking && offset + index === current}
          renaming={renaming === board.id}
          menu={menu}
          folders={folders}
        />
      ))}
    </ul>
  )

  const mineCount = here.filter((board) => board.owner?.id === me?.id).length
  const counts: Record<Filter, number> = {
    all: here.length + othersHere.length,
    mine: mineCount,
    shared: here.length - mineCount,
  }
  const nothingHere =
    place === 'starred'
      ? 'Star a board to keep it here.'
      : 'Move boards here from their menu or by dragging them onto the folder.'

  return (
    <Scroller className="absolute inset-0">
      <div className="mx-auto flex max-w-[1192px] flex-col gap-4 px-4 pt-32 pb-24 sm:px-8 md:flex-row md:gap-8">
        {(boards.length > 0 || others.length > 0 || trashed > 0) && (
          <Side
            place={place}
            onPlace={changePlace}
            folders={folders}
            counts={sideCounts}
            onDropBoard={dropBoard}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="truncate text-[20px] font-semibold tracking-[-0.01em]">{title}</h2>
            {place !== 'trash' && (
              <Button size="sm" onClick={() => newBoard.mutate()} disabled={newBoard.isPending}>
                <Plus strokeWidth={1.75} />
                New board
              </Button>
            )}
          </div>

          {place === 'trash' ? (
            <Trash me={me?.id} admin={me?.role === 'admin'} />
          ) : boards.length === 0 && others.length === 0 ? (
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
                      <span className="text-muted-foreground font-normal tabular-nums">
                        {counts[value]}
                      </span>
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
                <div className="ml-auto flex items-center gap-2">
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
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={layout}
                    onValueChange={(value) => value && changeLayout(value as Layout)}
                    aria-label="Layout"
                  >
                    <ToggleGroupItem value="grid" aria-label="Grid" className="px-2">
                      <LayoutGrid strokeWidth={1.75} />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="list" aria-label="List" className="px-2">
                      <List strokeWidth={1.75} />
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
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
                          : place !== 'all' && counts.all === 0
                            ? nothingHere
                            : filter === 'mine'
                              ? 'You own no boards yet.'
                              : 'Nobody has shared a board with you yet.'}
                      </p>
                    )}
                  </div>
                </ContextMenuTrigger>
                {pointed && (
                  <ContextMenuContent className="w-44" onCloseAutoFocus={menu.closed}>
                    <MenuItems kind="context" actions={actionsFor(pointed, demo, menu, folders)} />
                  </ContextMenuContent>
                )}
              </ContextMenu>
              {query.trim() !== '' && flat.length > 0 && (
                <p className="text-muted-foreground text-[12px]">
                  {flat.length} of {counts[filter]} boards
                </p>
              )}
            </>
          )}
        </div>
      </div>
      {sharing && (
        <ShareDialog board={sharing} open onOpenChange={(open) => !open && setSharing(null)} />
      )}
      <TrashBoardDialog board={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
    </Scroller>
  )
}

type Choice = { key: string; label: string; checked: boolean; run: () => void; separated?: boolean }
type Action = {
  label: string
  Icon: LucideIcon
  run?: () => void
  destructive?: boolean
  /** A submenu instead of `run`; empty, it says `empty`. */
  choices?: Choice[]
  empty?: string
}

type Menu = {
  rename: (id: string) => void
  /** A board menu's onCloseAutoFocus; true when it took the focus for a rename. */
  closed: (event: Event) => boolean
  renamed: () => void
  duplicate: (board: BoardSummary) => void
  share: (board: BoardSummary) => void
  remove: (board: BoardSummary) => void
  point: (board: BoardSummary) => void
  star: (board: BoardSummary, starred: boolean) => void
  move: (board: BoardSummary, folderId: string | null) => void
}

function actionsFor(board: BoardSummary, demo: boolean, menu: Menu, folders: Folder[]): Action[] {
  const inside = board.folder_id ?? null
  // Folder names may repeat, so a choice is known by the folder's id.
  const choices: Choice[] = folders.map((folder) => ({
    key: folder.id,
    label: folder.name,
    checked: folder.id === inside,
    run: () => folder.id !== inside && menu.move(board, folder.id),
  }))
  if (inside && choices.some((choice) => choice.checked)) {
    choices.push({
      key: 'none',
      label: 'No folder',
      checked: false,
      run: () => menu.move(board, null),
      separated: true,
    })
  }
  return [
    { label: 'Open', Icon: SquareArrowOutUpRight, run: () => goTo(board.id) },
    board.starred
      ? { label: 'Unstar', Icon: StarOff, run: () => menu.star(board, false) }
      : { label: 'Star', Icon: Star, run: () => menu.star(board, true) },
    ...(canEdit(board.my_role)
      ? [{ label: 'Rename', Icon: Pencil, run: () => menu.rename(board.id) }]
      : []),
    { label: 'Duplicate', Icon: Copy, run: () => menu.duplicate(board) },
    ...(demo ? [] : [{ label: 'Share', Icon: Share2, run: () => menu.share(board) }]),
    { label: 'Move to folder', Icon: FolderInput, choices, empty: 'No folders yet' },
    ...(board.my_role === 'owner'
      ? [
          {
            label: 'Move to trash…',
            Icon: Trash2,
            run: () => menu.remove(board),
            destructive: true,
          },
        ]
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
  folders: Folder[]
}

function openHere(event: MouseEvent<HTMLAnchorElement>, id: string) {
  // A new tab or window keeps the browser's own way.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  goTo(id)
}

type MenuProps = { board: BoardSummary; demo: boolean; menu: Menu; folders: Folder[] }

function dragBoard(event: DragEvent, board: BoardSummary) {
  event.dataTransfer.setData(BOARD_DRAG, board.id)
  event.dataTransfer.effectAllowed = 'move'
}

type StarProps = { board: BoardSummary; menu: Menu; className?: string }

/** A starred board keeps its star in sight; the others show it on hover, and always by touch. */
function StarButton({ board, menu, className }: StarProps) {
  const starred = !!board.starred
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={starred ? `Unstar ${board.name}` : `Star ${board.name}`}
      aria-pressed={starred}
      onClick={() => menu.star(board, !starred)}
      className={cn(
        'shrink-0',
        !starred && 'opacity-100 group-hover:opacity-100 focus-visible:opacity-100 sm:opacity-0',
        className,
      )}
    >
      <Star
        strokeWidth={1.75}
        className={starred ? 'fill-warning text-warning' : 'text-muted-foreground'}
      />
    </Button>
  )
}

function BoardMenu({ board, demo, menu, folders }: MenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0"
          aria-label={`Actions for ${board.name}`}
        >
          <MoreHorizontal strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        onCloseAutoFocus={(event) => {
          if (!menu.closed(event)) restoreFocusForKeyboard(event)
        }}
      >
        <MenuItems kind="dropdown" actions={actionsFor(board, demo, menu, folders)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BoardName({ board }: { board: BoardSummary }) {
  return (
    <>
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
    </>
  )
}

function Preview({ board }: { board: BoardSummary }) {
  // A board of only reminders or arrow ends has nothing to draw; the server then answers 404.
  const [failed, setFailed] = useState(false)
  if (board.preview == null || failed) {
    return (
      <span className="text-muted-foreground/50 flex size-full items-center justify-center text-[32px] font-semibold select-none">
        {board.name.trim().charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={previewUrl(board)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="size-full object-contain"
    />
  )
}

const BoardCard = memo(function BoardCard({
  board,
  own,
  demo,
  selected,
  renaming,
  menu,
  folders,
}: RowProps) {
  const edited = relativeTime(board.updated_at)
  return (
    <li
      data-flip={board.id}
      data-selected={selected}
      draggable={!renaming}
      onDragStart={(event) => dragBoard(event, board)}
      onContextMenu={() => menu.point(board)}
      className={cn(
        'group bg-card hover:border-foreground/20 relative flex min-w-0 flex-col rounded-lg border transition-colors',
        selected && 'ring-primary ring-2',
      )}
    >
      <div aria-hidden className="bg-muted/40 aspect-[8/5] overflow-hidden rounded-t-lg border-b">
        <Preview key={board.preview} board={board} />
      </div>
      <StarButton
        board={board}
        menu={menu}
        className="bg-background/80 hover:bg-background absolute top-2 right-2 z-10 size-7 border shadow-xs backdrop-blur-sm"
      />
      <div className="flex items-center gap-1 py-2 pr-1.5 pl-3">
        <div className="flex min-w-0 flex-1 flex-col">
          {renaming ? (
            <RenameBoardForm board={board} onDone={menu.renamed} />
          ) : (
            // The name's hit area stretches over the picture, so a click there opens the board
            // with one link to focus and one name to read.
            <a
              href={boardHref(board.id)}
              onClick={(event) => openHere(event, board.id)}
              draggable={false}
              className="flex min-w-0 items-center gap-2 rounded-sm text-[14px] outline-none after:absolute after:inset-x-0 after:top-0 after:aspect-[8/5] after:rounded-t-lg focus-visible:underline"
            >
              <BoardName board={board} />
            </a>
          )}
          <span className="text-muted-foreground truncate text-[12px] tabular-nums">
            <span>{own ? 'You' : board.owner?.name}</span>
            {edited && ` · Edited ${edited}`}
          </span>
        </div>
        <BoardMenu board={board} demo={demo} menu={menu} folders={folders} />
      </div>
    </li>
  )
})

const BoardRow = memo(function BoardRow({
  board,
  own,
  demo,
  selected,
  renaming,
  menu,
  folders,
}: RowProps) {
  const edited = relativeTime(board.updated_at)
  return (
    <li
      data-flip={board.id}
      data-selected={selected}
      draggable={!renaming}
      onDragStart={(event) => dragBoard(event, board)}
      onContextMenu={() => menu.point(board)}
      className={cn(
        'group hover:bg-accent/60 grid h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 first:rounded-t-lg last:rounded-b-lg sm:grid-cols-[minmax(0,1fr)_160px_168px_auto]',
        selected && 'bg-accent',
      )}
    >
      {renaming ? (
        <RenameBoardForm board={board} onDone={menu.renamed} />
      ) : (
        <div className="flex min-w-0 items-center gap-1">
          <a
            href={boardHref(board.id)}
            onClick={(event) => openHere(event, board.id)}
            draggable={false}
            className="flex min-w-0 items-center gap-2 rounded-sm text-[14px] outline-none focus-visible:underline"
          >
            <LayoutDashboard className="text-muted-foreground size-4 shrink-0" strokeWidth={1.75} />
            <BoardName board={board} />
          </a>
          <StarButton board={board} menu={menu} className="size-7" />
        </div>
      )}
      <span className="text-muted-foreground hidden truncate text-[13px] sm:block">
        {own ? 'You' : board.owner?.name}
      </span>
      <span className="text-muted-foreground hidden truncate text-[12px] whitespace-nowrap tabular-nums sm:block">
        {edited && `Edited ${edited}`}
      </span>
      <BoardMenu board={board} demo={demo} menu={menu} folders={folders} />
    </li>
  )
})

function MenuItems({ kind, actions }: { kind: 'dropdown' | 'context'; actions: Action[] }) {
  const dropdown = kind === 'dropdown'
  const Item = dropdown ? DropdownMenuItem : ContextMenuItem
  const Separator = dropdown ? DropdownMenuSeparator : ContextMenuSeparator
  const Sub = dropdown ? DropdownMenuSub : ContextMenuSub
  const SubTrigger = dropdown ? DropdownMenuSubTrigger : ContextMenuSubTrigger
  const SubContent = dropdown ? DropdownMenuSubContent : ContextMenuSubContent
  return actions.map(({ label, Icon, run, destructive, choices, empty }) => (
    <Fragment key={label}>
      {destructive && <Separator />}
      {choices ? (
        <Sub>
          <SubTrigger>
            <Icon strokeWidth={1.75} className="text-muted-foreground size-4" />
            {label}
          </SubTrigger>
          <SubContent className="max-h-72 w-48">
            {choices.length === 0 && <Item disabled>{empty}</Item>}
            {choices.map((choice) => (
              <Fragment key={choice.key}>
                {choice.separated && <Separator />}
                <Item onSelect={choice.run}>
                  <span className="truncate">{choice.label}</span>
                  {choice.checked && <Check strokeWidth={1.75} className="ml-auto" />}
                </Item>
              </Fragment>
            ))}
          </SubContent>
        </Sub>
      ) : (
        <Item variant={destructive ? 'destructive' : 'default'} onSelect={run}>
          <Icon strokeWidth={1.75} />
          {label}
        </Item>
      )}
    </Fragment>
  ))
}
