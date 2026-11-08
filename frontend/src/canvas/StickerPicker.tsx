import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Clock,
  Flag,
  Hand,
  Heart,
  Lightbulb,
  PartyPopper,
  PawPrint,
  Pizza,
  Plane,
  Search,
  Smile,
  Sticker as StickerIcon,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getAuthStatus } from '@/api/auth'
import {
  getPack,
  PACK_KEY,
  packKey,
  getStickers,
  packPictureUrl,
  removeFromPack,
  stickerUrl,
  type PackSticker,
  type Sticker,
} from '@/api/stickers'
import {
  readRecentStickers,
  rememberSticker,
  STICKER_DRAG,
  type StickerChoice,
} from '@/canvas/stickers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useReducedMotion } from '@/lib/motion'
import { SHORTCUTS, withShortcut } from '@/lib/shortcuts'
import { ERROR_MS } from '@/lib/toast'
import { cn } from '@/lib/utils'

// How long the pointer rests on a sticker before it plays.
const REST_MS = 200
const RECENT = 'Recent'
const WORKSPACE = 'Workspace'
// The sections of the built-in set, in the order the panel shows them.
const SECTIONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'Smileys and emotions', Icon: Smile },
  { name: 'People', Icon: Hand },
  { name: 'Animals and nature', Icon: PawPrint },
  { name: 'Food and drink', Icon: Pizza },
  { name: 'Activities and events', Icon: PartyPopper },
  { name: 'Travel and places', Icon: Plane },
  { name: 'Objects', Icon: Lightbulb },
  { name: 'Symbols', Icon: Heart },
  { name: 'Flags', Icon: Flag },
]
const TABS = [{ name: RECENT, Icon: Clock }, { name: WORKSPACE, Icon: Users }, ...SECTIONS]

function Cell({
  src,
  playing,
  name,
  choice,
  onPick,
  onDropped,
  onRemove,
}: {
  src: string
  /** Shown while the pointer or the focus is on the sticker; undefined when it stands still. */
  playing?: string
  name: string
  choice: StickerChoice
  onPick: (choice: StickerChoice) => void
  /** Dragged onto the board rather than clicked. */
  onDropped: (choice: StickerChoice) => void
  onRemove?: () => void
}) {
  // One sticker plays at a time, the one the pointer rests on: the panel stays light however
  // many it shows, and a pointer passing over it loads nothing.
  const [live, setLive] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const calm = useReducedMotion()
  const rest = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setLive(true), REST_MS)
  }
  const leave = () => {
    window.clearTimeout(timer.current)
    setLive(false)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <div className="group relative">
      <button
        onPointerEnter={rest}
        onPointerLeave={leave}
        onFocus={rest}
        onBlur={leave}
        type="button"
        title={name}
        aria-label={name}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(STICKER_DRAG, JSON.stringify(choice))
          event.dataTransfer.effectAllowed = 'copy'
        }}
        onDragEnd={(event) => {
          if (event.dataTransfer.dropEffect !== 'none') onDropped(choice)
        }}
        onClick={() => onPick(choice)}
        className="hover:bg-accent focus-visible:ring-ring grid size-14 place-items-center rounded-md outline-none focus-visible:ring-2"
      >
        <img
          src={live && playing && !calm ? playing : src}
          alt=""
          width={48}
          height={48}
          loading="lazy"
          draggable={false}
          className="size-12 object-contain"
        />
      </button>
      {onRemove && (
        <button
          type="button"
          title="Remove from the workspace's stickers"
          aria-label={`Remove ${name} from the workspace's stickers`}
          onClick={onRemove}
          className="bg-card absolute -top-1 -right-1 hidden rounded-full border p-0.5 shadow-sm group-focus-within:block group-hover:block"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

function matches(sticker: Sticker, query: string) {
  const found = (text: string) => text.toLowerCase().includes(query)
  return found(sticker.name) || sticker.tags.some(found)
}

/** The sticker panel over the toolbar: the built-in set by section, recents and the pack. */
export function StickerPicker({
  open,
  onOpenChange: setOpen,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (choice: StickerChoice) => void
}) {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState(readRecentStickers)
  const [tab, setTab] = useState(() => (recent.length ? RECENT : SECTIONS[0].name))
  const queryClient = useQueryClient()
  const catalog = useQuery({
    queryKey: ['stickers'],
    queryFn: getStickers,
    staleTime: Infinity,
    enabled: open,
  })
  const workspace = useQuery({ queryKey: ['auth'], queryFn: getAuthStatus }).data?.me?.workspace
  const pack = useQuery({ queryKey: packKey(workspace?.id), queryFn: getPack, enabled: open })
  const remove = useMutation({
    mutationFn: removeFromPack,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PACK_KEY }),
    onError: (error) =>
      toast.error('Not removed', { description: error.message, duration: ERROR_MS }),
  })

  const remember = (choice: StickerChoice) => {
    if (!('code' in choice)) return
    rememberSticker(choice.code)
    setRecent(readRecentStickers())
  }
  const pick = (choice: StickerChoice) => {
    remember(choice)
    onPick(choice)
  }

  const stickers = catalog.data ?? []
  const byCode = new Map(stickers.map((s) => [s.code, s]))
  const text = query.trim().toLowerCase()
  const packed = (pack.data ?? []).filter((s) => !text || s.name.toLowerCase().includes(text))
  const builtIn = text
    ? stickers.filter((s) => matches(s, text))
    : tab === RECENT
      ? recent.flatMap((code) => byCode.get(code) ?? [])
      : stickers.filter((s) => s.category === tab)
  const showPack = text ? packed.length > 0 : tab === WORKSPACE

  const packCell = (s: PackSticker) => (
    <Cell
      key={s.id}
      src={packPictureUrl(s.id, 96)}
      playing={s.file.moving ? packPictureUrl(s.id, 96, true) : undefined}
      name={s.name}
      choice={{ pack: s }}
      onPick={pick}
      onDropped={remember}
      onRemove={() => remove.mutate(s.id)}
    />
  )
  const builtInCell = (s: Sticker) => (
    <Cell
      key={s.code}
      src={stickerUrl(s.code, 96)}
      playing={stickerUrl(s.code, 96, true)}
      name={s.name}
      choice={{ code: s.code }}
      onPick={pick}
      onDropped={remember}
    />
  )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Opened again, the panel starts from its sections, not from the last search.
        if (!next) setQuery('')
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant={open ? 'secondary' : 'ghost'}
          size="icon"
          aria-label={SHORTCUTS.sticker.label}
          title={withShortcut('sticker')}
        >
          <StickerIcon className="size-[18px]" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={10} className="w-[392px] p-0">
        <div className="relative border-b p-2">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2" />
          <Input
            className="pl-8"
            placeholder="Search stickers"
            aria-label="Search stickers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        </div>
        {!text && (
          <div role="tablist" className="flex justify-between border-b px-2 py-1">
            {TABS.map(({ name, Icon }) => (
              <button
                key={name}
                type="button"
                role="tab"
                title={name}
                aria-label={name}
                aria-selected={tab === name}
                onClick={() => setTab(name)}
                className={cn(
                  'grid size-8 place-items-center rounded-md',
                  tab === name
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
              </button>
            ))}
          </div>
        )}
        {/* A fixed height: the panel keeps its size whatever a section holds. */}
        <div className="h-80 overflow-y-auto p-2">
          {catalog.isError ? (
            <Note>Stickers did not load. Close the panel and open it again.</Note>
          ) : showPack && pack.isPending ? (
            <Note>Loading the workspace's stickers…</Note>
          ) : showPack && pack.isError ? (
            <Note>
              The workspace's stickers did not load.{' '}
              <button
                type="button"
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => void pack.refetch()}
              >
                Try again
              </button>
            </Note>
          ) : showPack && packed.length === 0 ? (
            <Note>
              Select a picture on the board and pick <b>Save to stickers</b>. Everyone in the
              workspace finds it here.
            </Note>
          ) : !showPack && !builtIn.length && catalog.isSuccess ? (
            <Note>{text ? 'No stickers match.' : 'Stickers you add show here.'}</Note>
          ) : (
            <div className="grid grid-cols-6 content-start gap-1">
              {showPack && packed.map(packCell)}
              {(text || !showPack) && builtIn.map(builtInCell)}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-4 py-10 text-center text-[13px]">{children}</p>
}
