import { useReactFlow } from '@xyflow/react'
import { createContext, useContext } from 'react'

/** True inside an expanded module: it is drawn at 1:1, away from the board's zoom. */
export const ExpandedContext = createContext(false)

const one = () => 1

/** The scale between screen and module pixels, for pointer math in drags. */
export function useZoom() {
  const { getZoom } = useReactFlow()
  return useContext(ExpandedContext) ? one : getZoom
}

/** Opens a module over the dimmed board; null where the board has no such view. */
export const ExpandModuleContext = createContext<((id: string) => void) | null>(null)
