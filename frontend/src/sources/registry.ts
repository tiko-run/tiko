import githubMarkDark from '@/sources/marks/github-dark.svg'
import githubMark from '@/sources/marks/github.svg'
import jiraMark from '@/sources/marks/jira.svg'

type Source = {
  /** The tracker's name inside a sentence: "Open in Jira". */
  name: string
  /** The tracker's own logo file, shown as it is and never recolored; the demo has none. */
  mark?: string
  /** The owner's own file for dark backgrounds, when one file does not suit both themes. */
  markDark?: string
}

/** The trackers tiko reads tasks from, as the web app names and marks them. */
const SOURCES: Record<string, Source> = {
  jira: { name: 'Jira', mark: jiraMark },
  github: { name: 'GitHub', mark: githubMark, markDark: githubMarkDark },
  caldav: { name: 'CalDAV' },
  demo: { name: 'the demo tracker' },
}

export function sourceName(id: string) {
  return SOURCES[id]?.name ?? 'the tracker'
}

export function sourceMark(id: string) {
  return Object.hasOwn(SOURCES, id) ? SOURCES[id] : undefined
}

/** The key as a card shows it: a GitHub task without its owner, `repo#12`; a CalDAV task by
 *  its list, since its id is long and means nothing to people. */
export function shortKey(source: string | undefined, key: string, listName?: string) {
  if (source === 'caldav') return listName || 'Task'
  return source === 'github' ? key.slice(key.indexOf('/') + 1) : key
}

/** What a person connects to read the tracker: an account for CalDAV, a token elsewhere. */
export function credentialName(id: string) {
  return id === 'caldav' ? 'account' : 'token'
}

/** Whether this version knows the tracker; a board from a newer tiko may name one it does not. */
export function isKnownSource(id: string) {
  return Object.hasOwn(SOURCES, id)
}
