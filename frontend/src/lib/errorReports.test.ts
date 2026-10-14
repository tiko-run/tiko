import type { ErrorEvent } from '@sentry/browser'
import { expect, test } from 'vitest'
import { clean, scrub } from '@/lib/errorReports'

test('scrub hides addresses, hosts and emails but keeps file names', () => {
  expect(
    scrub(
      'Failed https://jira.corp.example.com/browse/X-1 for ann@example.com at 10.0.0.2 in board.tsx',
    ),
  ).toBe('Failed <url> for <email> at <ip> in board.tsx')
})

test('clean keeps only the error and names scripts without the host', () => {
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
          value: 'fetch https://jira.example.com failed',
          stacktrace: {
            frames: [{ filename: 'https://tiko.example.com/assets/index-abc.js', vars: { a: 1 } }],
          },
        },
      ],
    },
  } as unknown as ErrorEvent
  const kept = clean(event)
  expect(kept.request).toBeUndefined()
  expect(kept.user).toBeUndefined()
  expect(kept.breadcrumbs).toBeUndefined()
  expect(kept.message).toBe('see <host>')
  const value = kept.exception!.values![0]
  expect(value.value).toBe('fetch <url> failed')
  expect(value.stacktrace!.frames![0]).toEqual({ filename: 'app:///assets/index-abc.js' })
})
