import type { ErrorEvent } from '@sentry/browser'
import { z } from 'zod'
import { fetchJson } from '@/api/client'

const pageSchema = z.object({ dsn: z.string().nullable(), version: z.string(), deploy: z.string() })

const HOST = /^[a-z]+:\/\/[^/]+/i

/** Only the error type and its code lines: messages can hold task data or addresses. */
export function clean(event: ErrorEvent): ErrorEvent | null {
  if (!event.exception?.values?.length) return null
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    release: event.release,
    environment: event.environment,
    tags: event.tags,
    sdk: event.sdk,
    exception: {
      values: event.exception.values.map((value) => ({
        type: value.type,
        stacktrace: {
          frames: (value.stacktrace?.frames ?? []).map((frame) => ({
            filename: frame.filename?.replace(HOST, 'app://'),
            function: frame.function,
            lineno: frame.lineno,
            colno: frame.colno,
            in_app: frame.in_app,
          })),
        },
      })),
    },
  }
}

let started = false

/** Starts error reports for this page when an admin turned them on; loads the SDK only then. */
export async function startErrorReports() {
  if (started) return
  started = true
  const page = await fetchJson('/api/privacy/page', pageSchema)
  if (!page.dsn) return
  const Sentry = await import('@sentry/browser')
  Sentry.init({
    dsn: page.dsn,
    // Through tiko's own server, so Sentry never sees this page's address.
    tunnel: '/api/privacy/errors',
    release: page.version,
    environment: 'self-hosted',
    sendDefaultPii: false,
    defaultIntegrations: false,
    integrations: [
      Sentry.globalHandlersIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
    ],
    maxBreadcrumbs: 0,
    sendClientReports: false,
    beforeBreadcrumb: () => null,
    beforeSend: (event) => clean(event),
    initialScope: { tags: { deploy: page.deploy } },
  })
}
