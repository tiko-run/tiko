// Release pages are named after the version with dashes (2026-10-21); newest first.
export function byNewest(a, b) {
  const pa = a.split('-').map(Number)
  const pb = b.split('-').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i]
  return 0
}
