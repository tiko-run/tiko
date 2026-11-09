import { getViewportForBounds, useReactFlow, useStoreApi } from '@xyflow/react'
import { useCallback } from 'react'
import { reducedMotion } from '@/canvas/fly'
import { CARD_GUESS } from '@/canvas/layout'
import type { AppEdge, AppNode } from '@/canvas/types'

export type FitOptions = {
  /** Ids to fit; the whole board when left out. */
  nodes?: string[]
  padding: number
  maxZoom?: number
  animate?: boolean
}

/**
 * Fits nodes into the window by their stored size. xyflow's own fitView waits until every
 * node is measured, and a node off screen is never drawn, so it would never run.
 */
export function useFit() {
  const flow = useReactFlow<AppNode, AppEdge>()
  const store = useStoreApi<AppNode, AppEdge>()
  return useCallback(
    ({ nodes, padding, maxZoom, animate = true }: FitOptions) => {
      const { width, height, minZoom, maxZoom: storeMax, nodeLookup } = store.getState()
      const ids = nodes ?? [...nodeLookup.keys()]
      const rects = ids.flatMap((id) => {
        const node = nodeLookup.get(id)
        if (!node || node.hidden) return []
        // A task card never drawn has no size yet: its usual one keeps it inside the view.
        const size = {
          width: node.measured.width ?? node.width ?? CARD_GUESS.width,
          height: node.measured.height ?? node.height ?? CARD_GUESS.height,
        }
        return [{ ...node.internals.positionAbsolute, ...size }]
      })
      if (rects.length === 0 || !width || !height) return
      const x = Math.min(...rects.map((r) => r.x))
      const y = Math.min(...rects.map((r) => r.y))
      const right = Math.max(...rects.map((r) => r.x + r.width))
      const bottom = Math.max(...rects.map((r) => r.y + r.height))
      const bounds = { x, y, width: right - x, height: bottom - y }
      const viewport = getViewportForBounds(
        bounds,
        width,
        height,
        minZoom,
        maxZoom ?? storeMax,
        padding,
      )
      void flow.setViewport(viewport, { duration: animate && !reducedMotion() ? 400 : 0 })
    },
    [flow, store],
  )
}
