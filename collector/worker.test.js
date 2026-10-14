import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clean } from './worker.js'

const ping = {
  kind: 'ping',
  schema: 1,
  instance_id: '0b6f1c7e-3f4a-4c55-9b1e-6d2a8f0e9c41',
  version: '2026.10.20',
  deploy: 'installer',
  arch: 'arm64',
  trackers: ['github', 'jira_dc'],
  people: '2-5',
  boards: '6-20',
  updater: true,
}

test('keeps a documented ping as it is', () => {
  const { kind, schema, ...fields } = ping
  assert.deepEqual(clean(ping), { kind, schema, payload: fields })
})

test('drops fields it does not know', () => {
  const event = clean({ ...ping, hostname: 'tiko.example.com', email: 'ann@example.com' })
  assert.equal(event.payload.hostname, undefined)
  assert.equal(event.payload.email, undefined)
})

test('refuses values outside the documented ones', () => {
  assert.equal(clean({ ...ping, people: '7' }), null)
  assert.equal(clean({ ...ping, trackers: ['https://jira.example.com'] }), null)
  assert.equal(clean({ ...ping, version: 'my-fork' }), null)
  assert.equal(clean({ ...ping, schema: 2 }), null)
  assert.equal(clean({ ...ping, kind: 'click' }), null)
  assert.equal(clean({ ...ping, people: undefined }), null)
})

test('an install without failed_step stores null', () => {
  const install = {
    kind: 'install',
    schema: 1,
    version: '2026.10.20',
    os: 'darwin',
    arch: 'arm64',
    installer: 'sh',
    updater: true,
  }
  assert.equal(clean(install).payload.failed_step, null)
  assert.equal(clean({ ...install, failed_step: 'pull' }).payload.failed_step, 'pull')
  assert.equal(clean({ ...install, failed_step: 'Error: disk full at /home/ann' }), null)
})
