import { z } from 'zod'

const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

/** Fired when the session is gone, for example after a sign-out everywhere. */
export const AUTH_REQUIRED_EVENT = 'tiko:auth-required'
export const PASSWORD_CHANGE_EVENT = 'tiko:password-change-required'

export class ApiError extends Error {
  readonly code: string
  /** Seconds from the Retry-After header, when the server sent one. */
  readonly retryAfter?: number

  constructor(code: string, message: string, retryAfter?: number) {
    super(message)
    this.code = code
    this.retryAfter = retryAfter
  }
}

/** Fetches JSON and validates it; throws ApiError with the backend's unified error body. */
export async function fetchJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body)
    const retryAfter = Number(response.headers.get('retry-after')) || undefined
    // One place for every caller, including canvas autosave that bypasses React Query.
    if (parsed.success && parsed.data.error.code === 'auth_required') {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
    }
    if (parsed.success && parsed.data.error.code === 'password_change_required') {
      window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT))
    }
    throw parsed.success
      ? new ApiError(parsed.data.error.code, parsed.data.error.message, retryAfter)
      : new ApiError('http_error', `request failed with status ${response.status}`)
  }
  return schema.parse(body)
}
