import { toast } from 'sonner'
import { ERROR_MS } from '@/lib/toast'

/**
 * Copies a link shown in `field`; true when it reached the clipboard.
 * Browsers offer the clipboard only on HTTPS and localhost, so tiko opened by an IP address
 * over HTTP gets the link selected and a hint to copy it by hand.
 */
export async function copyLink(text: string, field: HTMLInputElement | null) {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard')
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    field?.focus()
    field?.select()
    toast.error('Could not copy. The link is selected: copy it by hand.', { duration: ERROR_MS })
    return false
  }
}
