import type { ErrorEvent } from '@sentry/browser'
import { afterEach, expect, test, vi } from 'vitest'

const init = vi.fn()
vi.mock('@sentry/browser', () => ({
  init,
  globalHandlersIntegration: () => ({}),
  linkedErrorsIntegration: () => ({}),
  dedupeIntegration: () => ({}),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  init.mockClear()
})

test('clean keeps only the error type and its code lines', async () => {
  const { clean } = await import('@/lib/errorReports')
  const event = {
    type: undefined,
    message: 'see tiko.example.com',
    request: { url: 'https://tiko.example.com/?board=42' },
    user: { ip_address: '1.2.3.4' },
    breadcrumbs: [{ message: 'clicked' }],
    release: '2026.10.20',
    exception: {
      values: [
        {
          type: 'TypeError',
          value: "Cannot read 'Fire Ann' of undefined",
          stacktrace: {
            frames: [
              {
                filename: 'https://tiko.example.com/assets/index-abc.js',
                function: 'render',
                lineno: 3,
                vars: { a: 1 },
              },
            ],
          },
        },
      ],
    },
  } as unknown as ErrorEvent
  const kept = clean(event)!
  expect(kept.request).toBeUndefined()
  expect(kept.user).toBeUndefined()
  expect(kept.breadcrumbs).toBeUndefined()
  expect(kept.message).toBeUndefined()
  expect(kept.exception!.values![0]).toEqual({
    type: 'TypeError',
    stacktrace: {
      frames: [
        {
          filename: 'app:///assets/index-abc.js',
          function: 'render',
          lineno: 3,
          colno: undefined,
          in_app: undefined,
        },
      ],
    },
  })
})

test('a message without an error is not sent', async () => {
  const { clean } = await import('@/lib/errorReports')
  expect(clean({ type: undefined, message: 'hello' } as ErrorEvent)).toBeNull()
})

test('with reports off the SDK is never started', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ dsn: null, version: '1', deploy: 'compose' })),
  )
  const { startErrorReports } = await import('@/lib/errorReports')
  await startErrorReports()
  expect(init).not.toHaveBeenCalled()
})

test('with reports on the SDK sends through tiko', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ dsn: 'https://k@o1.ingest.de.sentry.io/1', version: '1', deploy: 'compose' }),
    ),
  )
  const { startErrorReports } = await import('@/lib/errorReports')
  await startErrorReports()
  expect(init).toHaveBeenCalledWith(
    expect.objectContaining({ tunnel: '/api/privacy/errors', sendClientReports: false }),
  )
})
