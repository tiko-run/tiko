import type { BoardSummary } from '@/api/boards'

export type Filter = 'all' | 'mine' | 'shared'
/** Where on the side Home is: every board, the starred ones, one folder or the trash. */
export type Place = 'all' | 'starred' | 'trash' | { folder: string }

export const samePlace = (a: Place, b: Place) =>
  typeof a === 'object' && typeof b === 'object' ? a.folder === b.folder : a === b

export function inPlace(board: BoardSummary, place: Place) {
  if (place === 'all') return true
  if (place === 'starred') return !!board.starred
  if (place === 'trash') return false
  return board.folder_id === place.folder
}
export type Sort = 'updated' | 'name'

export type Layout = 'grid' | 'list'

export type HomeView = { sort: Sort; layout: Layout }

const VIEW = 'tiko.home'
const DEFAULT_VIEW: HomeView = { sort: 'updated', layout: 'grid' }

export function readView(): HomeView {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW) ?? '{}') as Partial<HomeView>
    return {
      sort: stored.sort === 'name' ? 'name' : DEFAULT_VIEW.sort,
      layout: stored.layout === 'list' ? 'list' : DEFAULT_VIEW.layout,
    }
  } catch {
    return DEFAULT_VIEW
  }
}

export function saveView(view: HomeView) {
  try {
    localStorage.setItem(VIEW, JSON.stringify(view))
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/** The boards a filter, a search and a sort leave, in the order Home shows them: starred first. */
export function visibleBoards(
  boards: BoardSummary[],
  { filter, query, sort, me }: { filter: Filter; query: string; sort: Sort; me?: string },
): BoardSummary[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const kept = boards.filter((board) => {
    const own = board.owner?.id === me
    if (filter === 'mine' && !own) return false
    if (filter === 'shared' && own) return false
    const name = board.name.toLowerCase()
    return words.every((word) => name.includes(word))
  })
  return kept.toSorted(
    (a, b) =>
      Number(!!b.starred) - Number(!!a.starred) ||
      (sort === 'name'
        ? byName.compare(a.name, b.name)
        : Date.parse(b.updated_at) - Date.parse(a.updated_at) ||
          // The server's tie-break: changes in the same second keep one order between reads.
          Date.parse(b.created_at) - Date.parse(a.created_at) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  )
}
