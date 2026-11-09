import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createBoard,
  duplicateBoard,
  importBoard,
  placeBoard,
  type BoardList,
  type BoardSummary,
} from '@/api/boards'
import { keepReport } from '@/board/import-report'
import { goTo } from '@/lib/navigation'
import { holdTourOn } from '@/onboarding/start'
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
      holdTourOn(board.id)
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

/** Accepted by the file picker and by a drop on Home. */
export const BOARD_FILE = '.tiko'

/** Makes a board from a `.tiko` file, in the folder open on Home, and opens it with its report. */
export function useImportBoard(folderId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      if (!file.name.toLowerCase().endsWith(BOARD_FILE)) {
        throw new Error(`${file.name} is not a tiko board. Export one from a board's menu.`)
      }
      const result = await importBoard(file)
      if (!folderId) return result
      // The board is made either way; a folder gone meanwhile only leaves it outside.
      await placeBoard(result.board.id, folderId).catch(() => undefined)
      return { ...result, board: { ...result.board, folder_id: folderId } }
    },
    onSuccess: (result) => {
      addToList(queryClient, result.board)
      keepReport(result)
      goTo(result.board.id)
    },
    onError: toastError,
  })
}
