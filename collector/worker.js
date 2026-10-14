// Receives tiko usage stats and keeps only the documented fields: https://docs.tiko.run/privacy/

const MAX_BODY = 2048
const PINGS_A_DAY = 10
const OS = ['linux', 'darwin', 'windows']
const DEPLOY = ['installer', 'compose', 'railway', 'render', 'source', 'demo']
const BUCKET = ['0', '1', '2-5', '6-20', '21-100', '100+']
const TRACKER = ['demo', 'jira_dc', 'github']
const STEP = ['docker-check', 'download', 'pull', 'start', 'health']
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
    failed_step: (v) => v === null || STEP.includes(v),
  },
  ping: {
    instance_id: matches(UUID),
    version: matches(VERSION),
    deploy: oneOf(DEPLOY),
    arch: matches(ARCH),
    trackers: (v) => Array.isArray(v) && v.length <= TRACKER.length && v.every(oneOf(TRACKER)),
    people: oneOf(BUCKET),
    boards: oneOf(BUCKET),
    updater: bool,
  },
}

/** The event to store, or null when it is not one of ours. */
export function clean(body) {
  if (!body || typeof body !== 'object' || body.schema !== 1) return null
  const fields = FIELDS[body.kind]
  if (!fields) return null
  const payload = {}
  for (const [name, valid] of Object.entries(fields)) {
    const value =
      body[name] === undefined &&
      (name === 'failed_step' || name === 'version') &&
      body.kind === 'install'
        ? null
        : body[name]
    if (!valid(value)) return null
    payload[name] = value
  }
  return { kind: body.kind, schema: 1, payload }
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
  // Rows older than 13 months become monthly totals; runs on the 1st, so a month goes at once.
  await sql(
    env,
    `INSERT INTO events_monthly (month, kind, dims, events, instances)
     SELECT date_trunc('month', received_at)::date, kind, payload - 'instance_id',
            count(*), count(DISTINCT instance_id)
     FROM events WHERE received_at < date_trunc('month', now()) - interval '12 months'
     GROUP BY 1, 2, 3
     ON CONFLICT (month, kind, dims) DO UPDATE
       SET events = events_monthly.events + excluded.events,
           instances = events_monthly.instances + excluded.instances`,
  )
  await sql(
    env,
    `DELETE FROM events WHERE received_at < date_trunc('month', now()) - interval '12 months'`,
  )
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
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
