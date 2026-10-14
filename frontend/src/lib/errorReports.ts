import type { ErrorEvent } from '@sentry/browser'
import { z } from 'zod'
import { fetchJson } from '@/api/client'

const URL_RE = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"<>]+/g
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g
const HOST_RE = /\b(?:[a-zA-Z0-9-]+\.)+(?:[a-zA-Z]{2,}|local|internal|lan|corp)\b/g
// Source file names look like host names to HOST_RE.
const FILE_RE = /\b[\w./-]+\.(?:js|ts|tsx|py|json)\b/g

const pageSchema = z.object({ dsn: z.string().nullable(), version: z.string(), deploy: z.string() })

/** Addresses, host names and emails out of a message, so a tracker URL never leaves. */
export function scrub(text: string): string {
  const files: string[] = []
  return text
    .replace(FILE_RE, (file) => `\0${files.push(file) - 1}\0`)
    .replace(URL_RE, '<url>')
    .replace(EMAIL_RE, '<email>')
    .replace(IP_RE, '<ip>')
    .replace(HOST_RE, '<host>')
    .replace(/\0(\d+)\0/g, (_, i: string) => files[Number(i)])
}

/** Only the error: no page address, no person, no breadcrumbs, scripts named without the host. */
export function clean(event: ErrorEvent): ErrorEvent {
  const kept: ErrorEvent = {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    release: event.release,
    environment: event.environment,
    tags: event.tags,
    sdk: event.sdk,
    exception: event.exception,
  }
  if (event.message) kept.message = scrub(event.message)
  for (const value of kept.exception?.values ?? []) {
    if (value.value) value.value = scrub(value.value)
    for (const frame of value.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = frame.filename.replace(/^[a-z]+:\/\/[^/]+/i, 'app://')
      if (frame.abs_path) frame.abs_path = frame.abs_path.replace(/^[a-z]+:\/\/[^/]+/i, 'app://')
      delete frame.vars
    }
  }
  return kept
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
