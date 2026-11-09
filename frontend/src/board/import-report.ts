import type { ImportResult } from '@/api/boards'

// Kept for this tab only: the report shows on the board just made from a file, until closed.
const reports = new Map<string, ImportResult>()

export function keepReport(result: ImportResult) {
  reports.set(result.board.id, result)
}

export function importReport(boardId: string) {
  return reports.get(boardId)
}

export function dropReport(boardId: string) {
  reports.delete(boardId)
}
