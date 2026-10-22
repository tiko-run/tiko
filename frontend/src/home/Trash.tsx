import { LayoutDashboard, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { TrashedBoard } from '@/api/trash'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { goTo } from '@/lib/navigation'
import { relativeTime, timeLeft } from '@/lib/time'
import { useDeleteForever, useRestore, useTrash } from './organize'

const goneOn = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })

type Props = { me?: string; admin: boolean }

/** Home's trash: deleted boards wait here 30 days; restore any, delete your own for good. */
export function Trash({ me, admin }: Props) {
  const trash = useTrash()
  const [purging, setPurging] = useState<TrashedBoard | null>(null)
  const boards = trash.data?.boards ?? []
  const restore = useRestore()
  const bringBack = (board: TrashedBoard) =>
    restore.mutate(board.id, {
      onSuccess: () =>
        toast.success(`${board.name} restored`, {
          action: { label: 'Open', onClick: () => goTo(board.id) },
        }),
    })

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-[13px]">
        Boards wait here 30 days, then they are deleted for good.
        {admin && ' As an admin you see the trash of everyone in this workspace.'}
      </p>
      {trash.isError && !trash.data && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            The trash did not load.
            <Button
              variant="outline"
              size="sm"
              disabled={trash.isFetching}
              onClick={() => void trash.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {trash.isSuccess && boards.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-[14px]">The trash is empty.</div>
      )}
      {boards.length > 0 && (
        <ul className="divide-y rounded-lg border" aria-label="Boards in the trash">
          {boards.map((board) => {
            const own = board.owner?.id === me
            const by = board.deleted_by && board.deleted_by.id !== me ? board.deleted_by.name : ''
            const left = timeLeft(board.purge_at)
            return (
              <li
                key={board.id}
                className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-1.5 sm:grid-cols-[minmax(0,1fr)_160px_120px_auto]"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-2 text-[14px]">
                    <LayoutDashboard
                      className="text-muted-foreground size-4 shrink-0"
                      strokeWidth={1.75}
                    />
                    <span className="truncate font-medium">{board.name}</span>
                  </span>
                  <span className="text-muted-foreground flex min-w-0 pl-6 text-[12px] tabular-nums">
                    <span className="truncate">
                      Deleted {relativeTime(board.deleted_at)}
                      {by && ` by ${by}`}
                    </span>
                    {/* On a phone the time left is the row's point: who and when give way first. */}
                    <span className="shrink-0 whitespace-pre sm:hidden"> · {left}</span>
                  </span>
                </div>
                <span className="text-muted-foreground hidden truncate text-[13px] sm:block">
                  {own ? 'You' : board.owner?.name}
                </span>
                <span
                  className="text-muted-foreground hidden text-[12px] whitespace-nowrap tabular-nums sm:block"
                  title={`Deleted for good on ${goneOn.format(Date.parse(board.purge_at))}`}
                >
                  {left}
                </span>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-8 text-[13px] sm:w-auto"
                    disabled={restore.isPending}
                    onClick={() => bringBack(board)}
                    aria-label={`Restore ${board.name}`}
                  >
                    <RotateCcw strokeWidth={1.75} />
                    <span className="hidden sm:inline">Restore</span>
                  </Button>
                  {own && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:text-destructive size-8"
                      onClick={() => setPurging(board)}
                      aria-label={`Delete ${board.name} for good`}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <PurgeDialog board={purging} onClose={() => setPurging(null)} />
    </div>
  )
}

function PurgeDialog({ board, onClose }: { board: TrashedBoard | null; onClose: () => void }) {
  const purge = useDeleteForever(onClose)
  return (
    <Dialog open={board !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete for good?</DialogTitle>
          <DialogDescription>
            "{board?.name}" and everything on it will be deleted. This cannot be undone. Tasks stay
            in their tracker.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={purge.isPending}
            onClick={() => board && purge.mutate(board.id)}
          >
            Delete for good
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
