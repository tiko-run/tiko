import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createBoard, duplicateBoard, type BoardList, type BoardSummary } from '@/api/boards'
import { goTo } from '@/lib/navigation'
import { toastError } from '@/lib/toast'

export const UNTITLED = 'Untitled board'

// The new board is in the list before the address names it, so the app never takes it for gone.
function addToList(queryClient: QueryClient, board: BoardSummary) {
  queryClient.setQueryData<BoardList>(['boards'], (list) =>
    list ? { ...list, boards: [board, ...list.boards] } : list,
  )
  void queryClient.invalidateQueries({ queryKey: ['boards'] })
}

/** Makes "Untitled board" and opens it with its name ready to type. */
export function useNewBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => createBoard(UNTITLED),
    onSuccess: (board) => {
      addToList(queryClient, board)
      goTo(board.id, { rename: true })
    },
    onError: toastError,
  })
}

/** Copies a board; the copy shows on Home with a toast that opens it. */
export function useDuplicateBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (board: BoardSummary) => duplicateBoard(board.id),
    onSuccess: (copy) => {
      addToList(queryClient, copy)
      toast.success(`${copy.name} created`, {
        action: { label: 'Open', onClick: () => goTo(copy.id) },
      })
    },
    onError: toastError,
  })
}
