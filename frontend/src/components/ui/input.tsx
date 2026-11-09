import * as React from "react"
import { cn } from "cn"

const TEXT_TYPES = new Set(["text", "password", "email", "search", "url", "tel", "number"])

// Some browsers (Aside, an AI browser) drop the submission Enter starts on its own, so the
// field sends it, following the browser's rule: a disabled default button keeps Enter idle.
function submitOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing) return
  // Date and other pickers keep their own Enter.
  if (!TEXT_TYPES.has(event.currentTarget.type)) return
  const form = event.currentTarget.form
  const button = form?.querySelector<HTMLButtonElement | HTMLInputElement>(
    'button:not([type]), button[type="submit"], input[type="submit"]'
  )
  if (!form || !button || button.disabled) return
  event.preventDefault()
  form.requestSubmit(button)
}

function Input({ className, type, onKeyDown, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        submitOnEnter(event)
      }}
      {...props}
    />
  )
}

export { Input }
