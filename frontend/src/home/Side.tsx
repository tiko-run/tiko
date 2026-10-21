import { Folder as FolderIcon, LayoutDashboard, MoreHorizontal, Plus, Star } from 'lucide-react'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Folder } from '@/api/folders'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from 'cn'
import { samePlace, type Place } from './list'
import { useCreateFolder, useDeleteFolder, useRenameFolder } from './organize'

/** What a dragged card or row carries: the board's id. */
export const BOARD_DRAG = 'application/x-tiko-board'

export type Counts = { all: number; starred: number; folders: Record<string, number> }

type Props = {
  place: Place
  onPlace: (place: Place) => void
  folders: Folder[]
  counts: Counts
  onDropBoard: (place: Place, boardId: string) => void
}

/** Home's side: every board, the starred ones and the person's folders. */
export function Side({ place, onPlace, folders, counts, onDropBoard }: Props) {
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const create = useCreateFolder()
  const rename = useRenameFolder()
  const remove = useDeleteFolder((id) => samePlace(place, { folder: id }) && onPlace('all'))

  const entry = (target: Place, label: string, icon: ReactNode, count: number) => (
    <Entry
      chosen={samePlace(place, target)}
      onChoose={() => onPlace(target)}
      onDropBoard={(boardId) => onDropBoard(target, boardId)}
      icon={icon}
      label={label}
      count={count}
    />
  )
  const plus = (className: string) => (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-6 shrink-0', className)}
      aria-label="New folder"
      onClick={() => setAdding(true)}
    >
      <Plus strokeWidth={1.75} />
    </Button>
  )

  return (
    <nav
      aria-label="Places"
      className="-mx-4 flex shrink-0 items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:sticky md:top-32 md:mx-0 md:w-[200px] md:flex-col md:items-stretch md:self-start md:overflow-visible md:px-0"
    >
      {entry('all', 'All boards', <LayoutDashboard strokeWidth={1.75} />, counts.all)}
      {entry('starred', 'Starred', <Star strokeWidth={1.75} />, counts.starred)}
      <div className="hidden items-center justify-between pt-4 pb-1 pl-2 md:flex">
        <span className="text-muted-foreground text-[12px] font-medium">Folders</span>
        {plus('')}
      </div>
      {folders.map((folder) =>
        renaming === folder.id ? (
          <FolderField
            key={folder.id}
            initial={folder.name}
            label="Folder name"
            onSave={(name) => name !== folder.name && rename.mutate({ id: folder.id, name })}
            onDone={() => setRenaming(null)}
          />
        ) : (
          <Entry
            key={folder.id}
            chosen={samePlace(place, { folder: folder.id })}
            onChoose={() => onPlace({ folder: folder.id })}
            onDropBoard={(boardId) => onDropBoard({ folder: folder.id }, boardId)}
            icon={<FolderIcon strokeWidth={1.75} />}
            label={folder.name}
            count={counts.folders[folder.id] ?? 0}
            menu={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 md:hidden md:group-focus-within:flex md:group-hover:flex md:data-[state=open]:flex"
                    aria-label={`Actions for ${folder.name}`}
                  >
                    <MoreHorizontal strokeWidth={1.75} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuItem onSelect={() => setRenaming(folder.id)}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate(folder.id)}>
                    Delete folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        ),
      )}
      {adding && (
        <FolderField
          initial=""
          label="New folder name"
          onSave={(name) => create.mutate(name)}
          onDone={() => setAdding(false)}
        />
      )}
      {!adding && plus('size-8 border md:hidden')}
    </nav>
  )
}

type EntryProps = {
  chosen: boolean
  onChoose: () => void
  onDropBoard: (boardId: string) => void
  icon: ReactNode
  label: string
  count: number
  menu?: ReactNode
}

function Entry({ chosen, onChoose, onDropBoard, icon, label, count, menu }: EntryProps) {
  const [over, setOver] = useState(false)
  const carries = (event: DragEvent) => event.dataTransfer.types.includes(BOARD_DRAG)
  return (
    <div
      className={cn(
        'group relative flex h-8 shrink-0 items-center rounded-md border text-[13px] md:border-transparent',
        chosen ? 'bg-accent font-medium' : 'hover:bg-accent/60',
        over && 'bg-accent ring-primary ring-1 ring-dashed',
      )}
      onDragOver={(event) => {
        if (!carries(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false)
        const boardId = event.dataTransfer.getData(BOARD_DRAG)
        if (!boardId) return
        event.preventDefault()
        onDropBoard(boardId)
      }}
    >
      <button
        type="button"
        onClick={onChoose}
        aria-current={chosen ? 'page' : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
      >
        {icon}
        <span className="truncate">{label}</span>
        <span
          className={cn(
            'text-muted-foreground ml-auto pl-2 text-[12px] font-normal tabular-nums',
            menu && 'md:group-focus-within:hidden md:group-hover:hidden',
          )}
        >
          {count}
        </span>
      </button>
      {menu && <div className="flex pr-1">{menu}</div>}
    </div>
  )
}

type FieldProps = {
  initial: string
  label: string
  onSave: (name: string) => void
  onDone: () => void
}

function FolderField({ initial, label, onSave, onDone }: FieldProps) {
  const [name, setName] = useState(initial)
  // Enter closes the field, and the blur that follows must not save it again.
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const trimmed = name.trim()
    if (save && trimmed) onSave(trimmed)
    onDone()
  }
  return (
    <Input
      autoFocus
      aria-label={label}
      value={name}
      maxLength={60}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true)
        else if (event.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
      onFocus={(event) => event.target.select()}
      className="h-7 w-40 shrink-0 text-[13px] md:w-auto"
    />
  )
}
