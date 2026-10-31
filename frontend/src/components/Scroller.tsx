import { useImperativeHandle, useState, type ComponentProps, type Ref } from 'react'
import { OverlayScrollbars } from '@/components/OverlayScrollbars'
import { cn } from '@/lib/utils'

type Props = ComponentProps<'div'> & {
  /** The scrolling box inside: its size limit, padding and layout. */
  viewportClassName?: string
  viewportRef?: Ref<HTMLDivElement>
}

/**
 * A scrolling area with thin bars drawn over the content, so no room is kept for them.
 * `className` sizes the frame; every other prop lands on the scrolling box.
 */
export function Scroller({ className, viewportClassName, viewportRef, children, ...rest }: Props) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  useImperativeHandle(viewportRef, () => el!, [el])
  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <div
        ref={setEl}
        {...rest}
        className={cn('no-scrollbar min-h-0 flex-1 overflow-auto', viewportClassName)}
      >
        {children}
      </div>
      <OverlayScrollbars target={el} />
    </div>
  )
}
