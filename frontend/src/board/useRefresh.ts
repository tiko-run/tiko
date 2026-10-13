import { useQuery } from '@tanstack/react-query'
import { refreshBoard } from '@/api/boards'
import { refreshPublicBoard } from '@/api/public'
import { getSettings } from '@/api/settings'
import { nextDelayS } from '@/board/refresh-timing'

const DEFAULT_INTERVAL_S = 30

/** Someone viewing a board by its public link, without an account. */
export type Guest = {
  token: string
  /** What the path of the link's socket ends with, from the board the link returned. */
  room: string
  intervalS: number
  /** Told whether the board is fed by its socket; while it is not, the page reloads it. */
  onLive?: (live: boolean) => void
}

/**
 * Polls the open board; pauses in a background tab unless `background` is set.
 * The server owns backoff per tracker. A guest refreshes through the board's public link.
 */
export function useRefresh(
  boardId: string,
  { background = false, guest }: { background?: boolean; guest?: Guest } = {},
) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings, enabled: !guest })
  const intervalS = guest?.intervalS ?? settings.data?.refresh_interval_s ?? DEFAULT_INTERVAL_S

  return useQuery({
    queryKey: ['refresh', boardId],
    queryFn: () => (guest ? refreshPublicBoard(guest.token) : refreshBoard(boardId)),
    refetchInterval: (query) => nextDelayS(intervalS, query.state.data?.sources ?? []) * 1000,
    // A timer waiting for a status must see the change while the user is in the tracker's tab.
    refetchIntervalInBackground: background,
    retry: false,
  })
}
