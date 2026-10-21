import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { deleteBoard, renameBoard, type BoardList, type BoardSummary } from '@/api/boards'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useRestore } from '@/home/organize'
import { goTo } from '@/lib/navigation'
import { ERROR_MS, toastError } from '@/lib/toast'

/** Inline name field in the top bar; Enter saves, Escape or leaving the field cancels. */
export function RenameBoardForm({ board, onDone }: { board: BoardSummary; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(board.name)
  const rename = useMutation({
    mutationFn: (value: string) => renameBoard(board.id, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['boards'] })
      onDone()
    },
    onError: toastError,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = name.trim()
    if (!value || value === board.name) return onDone()
    rename.mutate(value)
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <label htmlFor="board-rename" className="sr-only">
        Board name
      </label>
      <Input
        id="board-rename"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone()
        }}
        className="h-8 w-56"
        maxLength={100}
        autoFocus
        onFocus={(event) => event.target.select()}
        disabled={rename.isPending}
        aria-invalid={rename.isError}
      />
      <Button type="submit" size="icon" variant="ghost" aria-label="Save name">
        <Check strokeWidth={1.75} />
      </Button>
    </form>
  )
}

type TrashProps = {
  board: BoardSummary | null
  onOpenChange: (open: boolean) => void
}

/** Asks before a board moves to the trash, then offers to undo it. */
export function TrashBoardDialog({ board, onOpenChange }: TrashProps) {
  const queryClient = useQueryClient()
  const restore = useRestore()
  const trash = useMutation({
    mutationFn: (target: BoardSummary) => deleteBoard(target.id),
    onSuccess: (_, target) => {
      // Off the board first, so the app does not take it for one that was taken away.
      goTo(null, { replace: true })
      queryClient.setQueryData<BoardList>(['boards'], (list) =>
        list
          ? {
              boards: list.boards.filter((item) => item.id !== target.id),
              all: list.all.filter((item) => item.id !== target.id),
            }
          : list,
      )
      void queryClient.invalidateQueries({ queryKey: ['boards'] })
      void queryClient.invalidateQueries({ queryKey: ['trash'] })
      onOpenChange(false)
      toast.success(`${target.name} moved to the trash`, {
        action: { label: 'Undo', onClick: () => restore.mutate(target.id) },
        // Long enough to reach Undo.
        duration: ERROR_MS,
      })
    },
    onError: toastError,
  })
  return (
    <Dialog open={board !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move to trash?</DialogTitle>
          <DialogDescription>
            "{board?.name}" waits in the trash for 30 days. Until you restore it, people it is
            shared with lose it and its public link stops working.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={trash.isPending}
            onClick={() => board && trash.mutate(board)}
          >
            Move to trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
