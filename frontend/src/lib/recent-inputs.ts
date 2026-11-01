const KEY = 'tiko.card.recent'
const LIMIT = 5

/** The last inputs that added a card, newest first; kept in this browser only. */
export function readRecentInputs(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(stored)) return []
    const texts = stored
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item !== '')
    return [...new Set(texts)].slice(0, LIMIT)
  } catch {
    return []
  }
}

export function rememberInput(input: string) {
  const text = input.trim()
  if (!text) return
  const next = [text, ...readRecentInputs().filter((item) => item !== text)].slice(0, LIMIT)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private mode or blocked storage: nothing to offer next time.
  }
}
