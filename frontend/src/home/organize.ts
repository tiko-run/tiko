import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { placeBoard, starBoard, type BoardList, type BoardSummary } from '@/api/boards'
import { createFolder, deleteFolder, listFolders, renameFolder, type Folder } from '@/api/folders'
import { deleteForever, listTrash, restoreBoard, type TrashedBoard } from '@/api/trash'
import { toastError } from '@/lib/toast'

const BOARDS = ['boards']
const FOLDERS = ['folders']

type Change = { id: string; patch: Partial<BoardSummary> }

function patchBoards(queryClient: QueryClient, changes: Change[]) {
  const apply = (board: BoardSummary) => {
    const found = changes.find((change) => change.id === board.id)
    return found ? { ...board, ...found.patch } : board
  }
  queryClient.setQueryData<BoardList>(BOARDS, (list) =>
    list ? { boards: list.boards.map(apply), all: list.all.map(apply) } : list,
  )
}

// The list changes at once and goes back if the server says no.
function useBoardChange<V>(send: (vars: V) => Promise<unknown>, change: (vars: V) => Change) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: send,
    onMutate: async (vars: V) => {
      await queryClient.cancelQueries({ queryKey: BOARDS })
      const before = queryClient.getQueryData<BoardList>(BOARDS)
      patchBoards(queryClient, [change(vars)])
      return { before }
    },
    onError: (error, _vars, context) => {
      if (context?.before) queryClient.setQueryData(BOARDS, context.before)
      toastError(error)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: BOARDS }),
  })
}

export function useStar() {
  return useBoardChange(
    ({ id, starred }: { id: string; starred: boolean }) => starBoard(id, starred),
    ({ id, starred }) => ({ id, patch: { starred } }),
  )
}

export function usePlace() {
  return useBoardChange(
    ({ id, folderId }: { id: string; folderId: string | null }) => placeBoard(id, folderId),
    ({ id, folderId }) => ({ id, patch: { folder_id: folderId } }),
  )
}

export function useFolders(): Folder[] {
  return useQuery({ queryKey: FOLDERS, queryFn: listFolders }).data?.folders ?? []
}

export function useCreateFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createFolder,
    onSuccess: (folder) => {
      queryClient.setQueryData<{ folders: Folder[] }>(FOLDERS, (list) =>
        list ? { folders: [...list.folders, folder] } : list,
      )
      void queryClient.invalidateQueries({ queryKey: FOLDERS })
    },
    onError: toastError,
  })
}

export function useRenameFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameFolder(id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: FOLDERS }),
    onError: toastError,
  })
}

export function useDeleteFolder(onDeleted: (id: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteFolder,
    onSuccess: (_, id) => {
      const list = queryClient.getQueryData<BoardList>(BOARDS)
      const inside = [...(list?.boards ?? []), ...(list?.all ?? [])].filter(
        (board) => board.folder_id === id,
      )
      patchBoards(
        queryClient,
        inside.map((board) => ({ id: board.id, patch: { folder_id: null } })),
      )
      queryClient.setQueryData<{ folders: Folder[] }>(FOLDERS, (folders) =>
        folders ? { folders: folders.folders.filter((folder) => folder.id !== id) } : folders,
      )
      void queryClient.invalidateQueries({ queryKey: FOLDERS })
      void queryClient.invalidateQueries({ queryKey: BOARDS })
      onDeleted(id)
      toast.success('Folder deleted. Its boards stay on Home.')
    },
    onError: toastError,
  })
}

const TRASH = ['trash']

export function useTrash() {
  return useQuery({ queryKey: TRASH, queryFn: listTrash })
}

/** Takes a board out of the trash with its members, roles and public link. */
export function useRestore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: restoreBoard,
    onSuccess: (_, id) => {
      queryClient.setQueryData<{ boards: TrashedBoard[] }>(TRASH, (list) =>
        list ? { boards: list.boards.filter((board) => board.id !== id) } : list,
      )
      void queryClient.invalidateQueries({ queryKey: TRASH })
      void queryClient.invalidateQueries({ queryKey: BOARDS })
    },
    onError: toastError,
  })
}

export function useDeleteForever(onDone: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteForever,
    onSuccess: (_, id) => {
      queryClient.setQueryData<{ boards: TrashedBoard[] }>(TRASH, (list) =>
        list ? { boards: list.boards.filter((board) => board.id !== id) } : list,
      )
      void queryClient.invalidateQueries({ queryKey: TRASH })
      onDone()
    },
    onError: toastError,
  })
}
