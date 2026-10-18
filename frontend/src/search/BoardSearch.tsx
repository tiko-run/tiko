import { useReactFlow, type Viewport } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Task } from '@/api/tasks'
import { flyTo, reducedMotion, rememberView } from '@/canvas/fly'
import type { AppNode } from '@/canvas/types'
import { useShortcut } from '@/lib/shortcuts'
import { useCommandList, type Command } from './commands'
import { buildIndex, type Entry } from './index'
import {
  COMMANDS_PREFIX,
  searchPrefix,
  setSearchHits,
  setSearchOpen,
  useSearchOpen,
} from './palette'
import { pushRecent, readRecent } from './recent'
import { SearchPalette } from './SearchPalette'

// A preview never zooms out further than this, so the element stays readable.
const PREVIEW_MIN_ZOOM = 0.5

// Centers previews in the free space under the palette instead of behind it.
function belowPalette() {
  const palette = document.querySelector('[data-slot="dialog-content"]')
  if (!palette) return 0
  const free = (palette.getBoundingClientRect().bottom + window.innerHeight) / 2
  return free - window.innerHeight / 2
}

type Props = {
  boardId: string
  nodes: AppNode[]
  tasks: Record<string, Task>
  /** Moves the board to a node, selects only it and flashes it. */
  onJump: (id: string) => void
  /** Selects exactly these nodes. */
  onSelect: (ids: string[]) => void
}

export function BoardSearch({ boardId, nodes, tasks, onJump, onSelect }: Props) {
  const open = useSearchOpen()
  const commands = useCommandList()
  const flow = useReactFlow()
  useShortcut('search', () => setSearchOpen(true))
  useShortcut('commands', () => setSearchOpen(true, COMMANDS_PREFIX))
  // Built only while the palette is open, so editing the board costs nothing extra.
  const index = useMemo(() => (open ? buildIndex(nodes, tasks) : []), [open, nodes, tasks])
  const recent = useMemo(() => (open ? readRecent(boardId) : []), [open, boardId])
  // Where the board was when the palette opened, while a preview has moved it away.
  const before = useRef<Viewport | null>(null)
  const opened = useRef<Viewport | null>(null)

  useEffect(() => {
    if (open) opened.current = flow.getViewport()
    else setSearchHits(null)
  }, [open, flow])
  useEffect(() => () => setSearchHits(null), [])

  const preview = useCallback(
    (entry: Entry) => {
      before.current ??= opened.current
      flyTo(flow, entry.target, {
        flash: false,
        minZoom: PREVIEW_MIN_ZOOM,
        offsetY: belowPalette(),
      })
    },
    [flow],
  )

  const finish = () => {
    before.current = null
    setSearchOpen(false)
  }

  // Closing without a choice puts the board back where it was before the previews.
  const onOpenChange = (next: boolean) => {
    if (next) return setSearchOpen(true)
    const back = before.current
    finish()
    if (back) void flow.setViewport(back, { duration: reducedMotion() ? 0 : 300 })
  }

  // Runs after the palette is gone, so a dialog the command opens takes the focus.
  const run = (command: Command) => {
    finish()
    setTimeout(command.run, 0)
  }

  // A jump keeps the view the palette opened over, so "Back" returns there, not to a preview.
  const leave = () => {
    if (opened.current) rememberView(opened.current)
    finish()
  }

  const choose = (entry: Entry) => {
    leave()
    pushRecent(boardId, entry.id)
    onJump(entry.target)
  }

  const selectAll = (ids: string[]) => {
    leave()
    onSelect(ids)
    void flow.fitView({
      nodes: ids.map((id) => ({ id })),
      padding: 0.2,
      maxZoom: 1,
      duration: reducedMotion() ? 0 : 400,
    })
  }

  return (
    <SearchPalette
      open={open}
      onOpenChange={onOpenChange}
      index={index}
      recent={recent}
      initialText={searchPrefix()}
      onChoose={choose}
      commands={commands}
      onRun={run}
      onPreview={preview}
      onTargets={setSearchHits}
      onSelectAll={selectAll}
    />
  )
}
