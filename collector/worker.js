// Receives tiko usage stats and keeps only the documented fields: https://docs.tiko.run/privacy/

const MAX_BODY = 2048
const PINGS_A_DAY = 10
const OS = ['linux', 'darwin', 'windows', 'other']
const DEPLOY = ['installer', 'compose', 'railway', 'render', 'source', 'demo']
const BUCKET = ['0', '1', '2-5', '6-20', '21-100', '100+']
const TRACKER = ['demo', 'jira_dc', 'github']
const STEP = ['docker-check', 'download', 'pull', 'start', 'health']
const SCHEMAS = [1, 2]
const VERSION = /^\d{4}\.\d{1,2}\.\d{1,3}$/
const ARCH = /^[a-z0-9_]{1,16}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const oneOf = (values) => (v) => values.includes(v)
const matches = (re) => (v) => typeof v === 'string' && re.test(v)
const bool = (v) => typeof v === 'boolean'

// Field to check; a field not listed here is dropped.
const FIELDS = {
  install: {
    // Unknown when the install fails before the compose file is downloaded.
    version: (v) => v === null || matches(VERSION)(v),
    os: oneOf(OS),
    arch: matches(ARCH),
    installer: oneOf(['sh', 'ps1']),
    updater: bool,
    failed_step: (v) => v === null || oneOf(STEP)(v),
    fresh: bool,
  },
  ping: {
    instance_id: matches(UUID),
    version: matches(VERSION),
    deploy: oneOf(DEPLOY),
    arch: matches(ARCH),
    trackers: (v) => Array.isArray(v) && v.length <= TRACKER.length && v.every(oneOf(TRACKER)),
    people: oneOf(BUCKET),
    boards: oneOf(BUCKET),
    boards_active: oneOf(BUCKET),
    // Unknown when tiko runs in a container set up by hand.
    os: (v) => v === null || oneOf(OS)(v),
    updater: bool,
  },
}

// Fields a schema 1 sender does not have; they are stored as null.
const SINCE_2 = { install: ['fresh'], ping: ['boards_active', 'os'] }

/** The event to store, or null when it is not one of ours. */
export function clean(body) {
  if (!body || typeof body !== 'object' || !SCHEMAS.includes(body.schema)) return null
  const fields = FIELDS[body.kind]
  if (!fields) return null
  const payload = {}
  for (const [name, valid] of Object.entries(fields)) {
    if (body.schema === 1 && SINCE_2[body.kind].includes(name)) {
      payload[name] = null
      continue
    }
    // A missing field is null: only the fields that allow null pass.
    const value = body[name] === undefined ? null : body[name]
    if (!valid(value)) return null
    payload[name] = value
  }
  return { kind: body.kind, schema: body.schema, payload }
}

async function sql(env, query, params = []) {
  // Neon's HTTP endpoint for one statement; no driver, so the Worker is this one file.
  const host = new URL(env.DATABASE_URL.replace(/^postgres(ql)?:/, 'https:')).host
  const response = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: { 'Neon-Connection-String': env.DATABASE_URL, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
  })
  if (!response.ok) throw new Error(`database answered ${response.status}`)
  return response.json()
}

async function store(env, event, country) {
  const id = event.payload.instance_id ?? null
  // A ping counts at most PINGS_A_DAY times a day for one instance.
  await sql(
    env,
    `INSERT INTO events (kind, schema, instance_id, country, payload)
     SELECT $1, $2, $3::uuid, $4, $5::jsonb
     WHERE $3::uuid IS NULL OR (SELECT count(*) FROM events
       WHERE instance_id = $3::uuid AND received_at > now() - interval '1 day') < $6`,
    [event.kind, event.schema, id, country, JSON.stringify(event.payload), PINGS_A_DAY],
  )
}

async function rollUp(env) {
  // Months older than 13 full months become totals in one statement, so a failure moves nothing
  // and a month is counted once; runs on the 1st.
  await sql(
    env,
    `WITH moved AS (
       DELETE FROM events WHERE received_at < date_trunc('month', now()) - interval '13 months'
       RETURNING received_at, kind, instance_id, country, payload
     )
     INSERT INTO events_monthly (month, kind, dims, events, instances)
     SELECT date_trunc('month', received_at)::date, kind,
            (payload - 'instance_id') || jsonb_build_object('country', country),
            count(*), count(DISTINCT instance_id)
     FROM moved GROUP BY 1, 2, 3
     ON CONFLICT (month, kind, dims) DO UPDATE
       SET events = events_monthly.events + excluded.events,
           instances = events_monthly.instances + excluded.instances`,
  )
}

// The Cloud waitlist: one e-mail address per person who asked to hear when tiko Cloud opens.
const MAX_WAITLIST_BODY = 4096
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SOURCES = ['hero', 'self-host']
// What the person agreed to, stored with the address: the launch e-mail, and news only when ticked.
export const CONSENT = { launch: 'cloud-launch-email', news: 'cloud-launch-email+news' }
const ORIGIN =
  /^(https:\/\/(www\.)?tiko\.run|https:\/\/([a-z0-9-]+\.)?tiko(-[a-z0-9]+)?\.pages\.dev|http:\/\/localhost:\d+)$/

/** The address and the form it came from, or null when the body is not a sign-up. */
export function signUp(body) {
  if (!body || typeof body !== 'object') return null
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (email.length > 254 || !EMAIL.test(email)) return null
  if (!SOURCES.includes(body.source)) return null
  if (typeof body.token !== 'string' || !body.token || body.token.length > 2048) return null
  if (body.news !== undefined && typeof body.news !== 'boolean') return null
  return { email, source: body.source, token: body.token, news: body.news === true }
}

async function human(env, token, ip) {
  const form = new FormData()
  form.append('secret', env.TURNSTILE_SECRET)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  })
  if (!response.ok) return false
  return (await response.json()).success === true
}

async function waitlist(request, env) {
  const origin = request.headers.get('Origin') ?? ''
  const cors = ORIGIN.test(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {}
  const answer = (status, text = null) => new Response(text, { status, headers: cors })
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' },
    })
  }
  if (request.method !== 'POST') return answer(405, 'POST only')
  const text = await request.text()
  if (text.length > MAX_WAITLIST_BODY) return answer(413, 'too large')
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return answer(400, 'not JSON')
  }
  const entry = signUp(body)
  if (!entry) return answer(400, 'not a sign-up')
  // The address of the request only goes to the check, never to the database.
  if (!(await human(env, entry.token, request.headers.get('CF-Connecting-IP')))) {
    return answer(403, 'check failed')
  }
  const country = request.cf?.country ?? request.headers.get('CF-IPCountry') ?? null
  // The same address again is a success with no second row. A conflict target would need SELECT
  // on the table, which the Worker's role does not have on purpose.
  try {
    await sql(
      env,
      `INSERT INTO waitlist (email, source, news, consent, country) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [entry.email, entry.source, entry.news, entry.news ? CONSENT.news : CONSENT.launch, country],
    )
  } catch {
    return answer(500, 'not stored')
  }
  return answer(204)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/v1/waitlist') return waitlist(request, env)
    if (url.pathname !== '/v1/events') return new Response('not found', { status: 404 })
    if (request.method !== 'POST') return new Response('POST only', { status: 405 })
    const text = await request.text()
    if (text.length > MAX_BODY) return new Response('too large', { status: 413 })
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return new Response('not JSON', { status: 400 })
    }
    const event = clean(body)
    if (!event) return new Response('unknown event', { status: 400 })
    // The country only; the address of the request is never stored.
    const country = request.cf?.country ?? request.headers.get('CF-IPCountry') ?? null
    await store(env, event, country)
    return new Response(null, { status: 204 })
  },

  async scheduled(_controller, env) {
    await rollUp(env)
  },
}
