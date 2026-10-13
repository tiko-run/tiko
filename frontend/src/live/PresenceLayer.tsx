import { ViewportPortal, useViewport } from '@xyflow/react'
import { Avatar } from '@/live/Avatar'
import { useBoardPeers, useBoardTravel } from '@/live/presence'

/**
 * Other people's cursors on the canvas. What they have selected is drawn by the nodes
 * themselves (`PresenceRing`), so an outline can never lag behind its node.
 *
 * Drawn in board coordinates and scaled back, so a cursor is the same size at any zoom.
 * Nothing here takes pointer events: a cursor passing under the mouse must not steal a click.
 */
export function PresenceLayer() {
  const peers = useBoardPeers()
  const travel = useBoardTravel()
  const { zoom } = useViewport()
  if (peers.length === 0) return null
  const unscale = { transform: `scale(${1 / zoom})` }
  return (
    <ViewportPortal>
      {peers.map(
        (peer) =>
          peer.cursor && (
            <div
              key={peer.client}
              className="presence-cursor pointer-events-none absolute top-0 left-0"
              style={{
                transform: `translate(${peer.cursor.x}px, ${peer.cursor.y}px)`,
                transitionDuration: `${travel}ms`,
                zIndex: 1001,
              }}
            >
              <div className="origin-top-left" style={unscale}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path
                    d="M1.5 1.5 6 14.5l2.2-5.3 5.3-2.2z"
                    fill={`var(--presence-${peer.user.color})`}
                    stroke="var(--card)"
                    strokeWidth="1"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="absolute top-2.5 left-2.5 flex items-center gap-1">
                  <Avatar user={peer.user} className="ring-card size-[18px] text-[8px] ring-1" />
                  <span
                    className="presence-name text-presence-foreground rounded-sm px-1 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap"
                    style={{ backgroundColor: `var(--presence-${peer.user.color})` }}
                  >
                    {peer.user.name}
                  </span>
                </div>
              </div>
            </div>
          ),
      )}
    </ViewportPortal>
  )
}
