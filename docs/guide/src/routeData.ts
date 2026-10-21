import { defineRouteMiddleware, type StarlightRouteData } from '@astrojs/starlight/route-data'
import { getCollection } from 'astro:content'

type Entry = StarlightRouteData['sidebar'][number]

// One frontmatter flag, `experimental: true`, puts an EXP badge on the page's sidebar link.
export const onRequest = defineRouteMiddleware(async ({ locals }) => {
  const pages = await getCollection('docs', (entry) => entry.data.experimental)
  if (!pages.length) return
  const hrefs = new Set(pages.map((entry) => (entry.id === 'index' ? '/' : `/${entry.id}/`)))
  const mark = (entries: Entry[]) => {
    for (const entry of entries) {
      if (entry.type === 'group') mark(entry.entries)
      else if (hrefs.has(entry.href)) entry.badge = { text: 'EXP', variant: 'caution', class: 'tiko-exp' }
    }
  }
  mark(locals.starlightRoute.sidebar)
})
