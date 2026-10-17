import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clean, signUp } from './worker.js'

const ping = {
  kind: 'ping',
  schema: 2,
  instance_id: '0b6f1c7e-3f4a-4c55-9b1e-6d2a8f0e9c41',
  version: '2026.10.20',
  deploy: 'installer',
  arch: 'arm64',
  trackers: ['github', 'jira_dc'],
  people: '2-5',
  boards: '6-20',
  boards_active: '2-5',
  os: 'linux',
  updater: true,
}

test('keeps a documented ping as it is', () => {
  const { kind, schema, ...fields } = ping
  assert.deepEqual(clean(ping), { kind, schema, payload: fields })
})

test('a schema 1 ping stores the newer fields as null', () => {
  const { boards_active, os, ...old } = ping
  const event = clean({ ...old, schema: 1, os: 'linux' })
  assert.equal(event.schema, 1)
  assert.equal(event.payload.boards_active, null)
  assert.equal(event.payload.os, null)
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
  assert.equal(clean({ ...ping, schema: 3 }), null)
  assert.equal(clean({ ...ping, os: 'freebsd' }), null)
  assert.equal(clean({ ...ping, boards_active: undefined }), null)
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
  assert.equal(clean(install).payload.fresh, null)
  assert.equal(clean(install).payload.os, 'darwin')
  assert.equal(clean({ ...install, schema: 2, fresh: false }).payload.fresh, false)
  assert.equal(clean({ ...install, schema: 2 }), null)
})

const signup = { email: ' Ann@Example.com ', source: 'hero', token: 'tok' }

test('a sign-up keeps the address in lower case without spaces', () => {
  assert.deepEqual(signUp(signup), { email: 'ann@example.com', source: 'hero', token: 'tok', news: false })
  assert.equal(signUp({ ...signup, news: true }).news, true)
})

test('refuses a sign-up without a valid address, form or check', () => {
  assert.equal(signUp({ ...signup, email: 'ann' }), null)
  assert.equal(signUp({ ...signup, email: 'ann@example' }), null)
  assert.equal(signUp({ ...signup, email: `${'a'.repeat(250)}@x.io` }), null)
  assert.equal(signUp({ ...signup, source: 'footer' }), null)
  assert.equal(signUp({ ...signup, token: '' }), null)
  assert.equal(signUp({ ...signup, news: 'yes' }), null)
  assert.equal(signUp(null), null)
})
