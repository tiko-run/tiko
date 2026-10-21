import type { BoardSummary } from '@/api/boards'

export type Filter = 'all' | 'mine' | 'shared'
export type Sort = 'updated' | 'name'

export type HomeView = { sort: Sort }

const VIEW = 'tiko.home'
const DEFAULT_VIEW: HomeView = { sort: 'updated' }

export function readView(): HomeView {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW) ?? '{}') as Partial<HomeView>
    return { sort: stored.sort === 'name' ? 'name' : DEFAULT_VIEW.sort }
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

/** The boards a filter, a search and a sort leave, in the order Home shows them. */
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
  return sort === 'name'
    ? kept.toSorted((a, b) => byName.compare(a.name, b.name))
    : kept.toSorted(
        (a, b) =>
          Date.parse(b.updated_at) - Date.parse(a.updated_at) ||
          // The server's tie-break: changes in the same second keep one order between reads.
          Date.parse(b.created_at) - Date.parse(a.created_at) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
}
