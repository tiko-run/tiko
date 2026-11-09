import { createContext, useContext } from 'react'
import type { FileSource } from '@/api/files'

/** The six reactions, in the order they are shown; `code` is the built-in sticker drawing it. */
export const REACTIONS = [
  { id: 'like', code: '1f44d', label: 'Like' },
  { id: 'love', code: '2764_fe0f', label: 'Love' },
  { id: 'party', code: '1f389', label: 'Celebrate' },
  { id: 'laugh', code: '1f602', label: 'Funny' },
  { id: 'think', code: '1f914', label: 'Hmm' },
  { id: 'dislike', code: '1f44e', label: 'Dislike' },
] as const
export type ReactionId = (typeof REACTIONS)[number]['id']

// One key per person, so two people reacting at once never write the same key of the live doc.
const KEY = 'reaction:'
export const reactionKey = (person: string) => KEY + person
export const isReactionKey = (field: string) => field.startsWith(KEY)

/** The node types people react to. */
export const reacts = (type: string | undefined) => type === 'sticky' || type === 'task_card'

/** Who put each emoji, in the set's order; emoji nobody put are left out. */
export function reactionsOf(data: Record<string, unknown>): { id: ReactionId; people: string[] }[] {
  const people = new Map<string, string[]>()
  for (const [field, value] of Object.entries(data)) {
    if (!isReactionKey(field) || !Array.isArray(value)) continue
    for (const id of value) {
      if (typeof id !== 'string') continue
      const list = people.get(id)
      if (list) list.push(field.slice(KEY.length))
      else people.set(id, [field.slice(KEY.length)])
    }
  }
  return REACTIONS.flatMap(({ id }) => {
    const list = people.get(id)
    return list ? [{ id, people: list }] : []
  })
}

const KNOWN = new Set<string>(REACTIONS.map((r) => r.id))

/** The person's emoji on an element; a broken value from another tab is cleaned, not carried on. */
export function mine(data: Record<string, unknown>, person: string): ReactionId[] {
  const value = data[reactionKey(person)]
  if (!Array.isArray(value)) return []
  return [...new Set(value)].filter((id): id is ReactionId => KNOWN.has(id as string))
}

/** A copy of an element starts with no reactions. */
export function withoutReactions<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(Object.entries(data).filter(([field]) => !isReactionKey(field))) as T
}

/**
 * The person's new emoji on each element after picking `id`: it goes on every element, or off
 * all of them when every one has it already. Undefined clears the person's key.
 */
export function toggled(
  datas: Record<string, unknown>[],
  person: string,
  id: ReactionId,
): (ReactionId[] | undefined)[] {
  const off = datas.length > 0 && datas.every((data) => mine(data, person).includes(id))
  return datas.map((data) => {
    const have = mine(data, person)
    if (off) {
      const left = have.filter((other) => other !== id)
      return left.length ? left : undefined
    }
    return have.includes(id) ? have : [...have, id]
  })
}

/** The people in `ids`: the viewer first as "You", the rest by name. */
export function reactors(
  ids: string[],
  me: string | undefined,
  names: Map<string, string>,
): { id: string; name: string; known: boolean }[] {
  const others = ids
    .filter((id) => id !== me)
    .map((id) => ({ id, name: names.get(id) ?? 'Former member', known: names.has(id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return me && ids.includes(me) ? [{ id: me, name: 'You', known: true }, ...others] : others
}

export type ReactionsHost = {
  me?: string
  /** Names by person id; null on a public link, where people stay unnamed. */
  names: Map<string, string> | null
  /** Absent for viewers and guests, who only see reactions. */
  react?: (ids: string[], id: ReactionId) => void
  source?: FileSource
}

export const ReactionsContext = createContext<ReactionsHost>({ names: null })
export const useReactions = () => useContext(ReactionsContext)
