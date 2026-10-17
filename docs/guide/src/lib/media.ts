// Clips and stills live in R2 behind media.tiko.run; `astro dev` serves local copies from public/casts.
const BASE = import.meta.env.DEV ? '/casts/' : 'https://media.tiko.run/whats-new/'

export const media = (path?: string) => path?.replace(/^\/casts\//, BASE)
