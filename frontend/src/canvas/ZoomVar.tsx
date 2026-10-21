import { useStore } from '@xyflow/react'
import { useEffect } from 'react'

/** Puts the zoom into the `--zoom` CSS variable on the board, so CSS can size grips in screen pixels. */
export function ZoomVar() {
  const zoom = useStore((s) => s.transform[2])
  const dom = useStore((s) => s.domNode)
  useEffect(() => {
    dom?.style.setProperty('--zoom', String(zoom))
  }, [dom, zoom])
  return null
}
