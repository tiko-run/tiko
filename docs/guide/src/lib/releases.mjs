// Release pages are named after the version with dashes (2026-10-21); "next" is the unreleased one.
export function byNewest(a, b) {
  if (a === 'next') return -1
  if (b === 'next') return 1
  const pa = a.split('-').map(Number)
  const pb = b.split('-').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i]
  return 0
}
