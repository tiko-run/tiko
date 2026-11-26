import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { copiesKey, restoreCopy, type BoardCopy, type BoardSummary } from '@/api/boards'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { relativeTime } from '@/lib/time'
import { toastError } from '@/lib/toast'

const savedAt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function what(copy: BoardCopy) {
  const who = copy.by ?? 'Someone who left'
  return copy.reason === 'key' ? `Before ${who}'s API key changed it` : `Before ${who} restored it`
}

type Props = {
  board: BoardSummary
  copies: BoardCopy[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The board as it was before an agent changed people's work, to put back without the agent. */
export function SavedCopiesDialog({ board, copies, open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<BoardCopy | null>(null)
  const restore = useMutation({
    mutationFn: (copy: BoardCopy) => restoreCopy(board.id, copy.id),
    onSuccess: (_, copy) => {
      void queryClient.invalidateQueries({ queryKey: copiesKey(board.id) })
      setPicked(null)
      onOpenChange(false)
      toast.success(`Board restored to ${savedAt.format(new Date(copy.saved_at))}`)
    },
    onError: toastError,
  })
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Saved copies</DialogTitle>
            <DialogDescription>
              tiko saves the board before an API key changes or removes people's work, and before
              each restore. Copies are kept for 14 days.
            </DialogDescription>
          </DialogHeader>
          {copies.length === 0 ? (
            <p className="text-muted-foreground text-sm">No copies yet.</p>
          ) : (
            <ul className="-mx-2 max-h-80 overflow-y-auto">
              {copies.map((copy) => (
                <li
                  key={copy.id}
                  className="hover:bg-accent flex items-center gap-3 rounded-md px-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{what(copy)}</p>
                    <p className="text-muted-foreground text-[12px]">
                      <time dateTime={copy.saved_at} title={relativeTime(copy.saved_at) ?? ''}>
                        {savedAt.format(new Date(copy.saved_at))}
                      </time>{' '}
                      · {copy.elements} {copy.elements === 1 ? 'element' : 'elements'}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setPicked(copy)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={picked !== null} onOpenChange={(next) => !next && setPicked(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Restore this copy?</DialogTitle>
            <DialogDescription>
              "{board.name}" goes back to how it was on{' '}
              {picked && savedAt.format(new Date(picked.saved_at))}, for everyone who has it open
              {board.public ? ' and on its public link' : ''}. The board as it is now is saved
              first, so you can undo this the same way.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicked(null)}>
              Cancel
            </Button>
            <Button disabled={restore.isPending} onClick={() => picked && restore.mutate(picked)}>
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
