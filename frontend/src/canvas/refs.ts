import { ApiError } from '@/api/client'
import { choosePrefix, resolveTask, type Task } from '@/api/tasks'
import { askPrefix } from '@/canvas/prefixQuestion'
import { OWN_KEY_PATTERNS, OWN_KEY_PREFIXES, OWN_LINK_PATTERNS } from '@/sources/registry'

export const MAX_REFS = 50
// Each key is one request to the tracker; a few at a time stays clear of rate limits.
const CONCURRENCY = 4

export type Resolved = {
  tasks: Task[]
  failed: { ref: string; message: string }[]
  /** Set for a JQL query: how many tasks matched, including the ones past the limit; null
   *  when the tracker gives no count. */
  total?: number | null
  /** Set for a query: more tasks match than were added. */
  more?: boolean
  /** True when `total` is the tracker's estimate. */
  estimated?: boolean
}

// Jira keys and links reach the instance's tracker; other trackers bring their own from the registry.
const JIRA_PROJECT = '[A-Za-z][A-Za-z0-9_]+'
const JIRA_KEY = `${JIRA_PROJECT}-\\d+`
const KEYS = [JIRA_KEY, ...OWN_KEY_PATTERNS].join('|')

export const REF_RE = new RegExp(`^(${KEYS}|https?://\\S+)$`)
// Only a key or a link to a task page counts on paste, so other links stay text.
const TASK_REF_RE = new RegExp(
  `^(${KEYS}|https?://\\S+/browse/${JIRA_KEY}/?` +
    `|https?://\\S+[?&]selectedIssue=${JIRA_KEY}(&\\S*)?` +
    OWN_LINK_PATTERNS.map((link) => `|${link}`).join('') +
    ')$',
)

// "APP-1 - APP-20", "APP-1..20", "owner/repo#3 – #9": every key from the first to the last.
const RANGE_RE = new RegExp(
  `(?<![\\w/.#-])(${[`${JIRA_PROJECT}-`, ...OWN_KEY_PREFIXES].join('|')})(\\d+)\\s*(?:-|–|—|\\.\\.)\\s*(?:\\1|#)?(\\d+)(?![\\w#/-])`,
  'gi',
)

/** True when the input holds a range of keys. */
export function hasRange(input: string) {
  RANGE_RE.lastIndex = 0
  return RANGE_RE.test(input)
}

function expandRanges(input: string) {
  return input.replace(RANGE_RE, (_whole, prefix: string, from: string, to: string) => {
    const [low, high] = [Number(from), Number(to)].sort((a, b) => a - b)
    // One past the limit is enough for the form to refuse; a typo of a million keys is not built.
    const count = Math.min(high - low + 1, MAX_REFS + 1)
    return Array.from({ length: count }, (_, i) => `${prefix}${low + i}`).join(' ')
  })
}

export function splitRefs(input: string) {
  return [
    ...new Set(
      expandRanges(input)
        .split(/[\s,;]+/)
        .filter(Boolean),
    ),
  ]
}

/** The task refs in pasted text when it holds nothing else: the first `MAX_REFS`, and whether more were left out. */
export function pastedRefs(text: string): { refs: string[]; more: boolean } | null {
  const refs = splitRefs(text)
  if (refs.length === 0 || !refs.every((ref) => TASK_REF_RE.test(ref))) return null
  return { refs: refs.slice(0, MAX_REFS), more: refs.length > MAX_REFS }
}

type Settled = PromiseSettledResult<Task>

async function settleAll(refs: string[], source?: string): Promise<Settled[]> {
  const results: Settled[] = []
  let next = 0
  const worker = async () => {
    while (next < refs.length) {
      const i = next++
      results[i] = await resolveTask(refs[i], source).then(
        (value) => ({ status: 'fulfilled', value }) as const,
        (reason: unknown) => ({ status: 'rejected', reason }) as const,
      )
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, refs.length) }, worker))
  return results
}

/** The prefix and the trackers of a bare key two of the person's trackers know. */
function ambiguity(result: Settled): { prefix: string; sources: string[] } | null {
  if (result.status !== 'rejected') return null
  const error = result.reason
  if (!(error instanceof ApiError) || error.code !== 'ambiguous_key') return null
  const { prefix, sources } = error.details
  return typeof prefix === 'string' && Array.isArray(sources)
    ? { prefix, sources: sources.map(String) }
    : null
}

/** Resolves every ref; a bare key whose prefix two trackers know is asked about once per prefix. */
export async function resolveAll(refs: string[]): Promise<Resolved> {
  const results = await settleAll(refs)
  const byPrefix = new Map<string, { sources: string[]; at: number[] }>()
  results.forEach((result, i) => {
    const found = ambiguity(result)
    if (!found) return
    const group = byPrefix.get(found.prefix) ?? { sources: found.sources, at: [] }
    group.at.push(i)
    byPrefix.set(found.prefix, group)
  })
  for (const [prefix, { sources, at }] of byPrefix) {
    const answer = await askPrefix({ prefix, key: refs[at[0]].toUpperCase(), sources })
    if (!answer) {
      const reason = new Error(`Pick where ${prefix} keys are from to add them.`)
      at.forEach((i) => (results[i] = { status: 'rejected', reason }))
      continue
    }
    // A choice that fails to save still adds the cards; the dialog asks again next time.
    if (answer.remember) await choosePrefix(prefix, answer.source).catch(() => undefined)
    const again = await settleAll(
      at.map((i) => refs[i]),
      answer.source,
    )
    at.forEach((i, j) => (results[i] = again[j]))
  }
  const resolved: Resolved = { tasks: [], failed: [] }
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') resolved.tasks.push(result.value)
    else resolved.failed.push({ ref: refs[i], message: errorMessage(result.reason) })
  })
  return resolved
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not add the card'
}
