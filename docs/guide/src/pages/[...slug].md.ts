import type { APIRoute, GetStaticPaths } from 'astro'
import { getCollection, type CollectionEntry } from 'astro:content'
import { byNewest } from '../lib/releases.mjs'

type Props = { entry: CollectionEntry<'docs'>; releases: string }

// Every guide page as plain Markdown at /<page>.md, for "Copy page" and for AI assistants to read.
export const getStaticPaths: GetStaticPaths = async () => {
  const pages = await getCollection('docs')
  const releases = pages
    .filter((entry) => entry.id.startsWith('whats-new/'))
    .sort((a, b) => byNewest(a.id.slice(10), b.id.slice(10)))
    .map((entry) => `- [${entry.data.title}](/${entry.id}/): ${entry.data.description}`)
    .join('\n')
  return pages.map((entry) => ({ params: { slug: entry.id }, props: { entry, releases } }))
}

const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))

export const GET: APIRoute<Props> = ({ props: { entry, releases }, site }) => {
  const { title, description } = entry.data
  const page = new URL(entry.id === 'index' ? '/' : `/${entry.id}/`, site)
  const link = (href: string) => new URL(href, page).href
  let body = (entry.body ?? '')
    // MDX imports mean nothing outside the site.
    .replace(/^import .+$\n?/gm, '')
    // The guide's components become the Markdown they stand for; their media stay on the site.
    .replace(/<LinkCard\b[^>]*\/>/g, (tag) => {
      const { title, description, href } = attrs(tag)
      return `- [${title}](${link(href)})${description ? `: ${description}` : ''}`
    })
    .replace(/<(Feature|Detail|Card)\b[^>]*>/g, (tag, name: string) => {
      const { title, area, href } = attrs(tag)
      if (name !== 'Feature') return `**${title}**\n`
      return [`### ${area ? `${area}: ` : ''}${title}`, href && `[Read in the guide](${link(href)})`].filter(Boolean).join('\n\n') + '\n'
    })
    .replace(/<ReleaseList\s*\/>/g, releases)
    // A tab's content follows its label, so every system's steps stay in the twin.
    .replace(/<TabItem\b[^>]*>/g, (tag) => `**${attrs(tag).label}**\n`)
    .replace(/<\/?(Feature|Details?|Card|CardGrid|Tabs|TabItem|Steps)\b[^>]*>/g, '')
    // Callouts become quotes with their title.
    .replace(/^:::(\w+)(?:\[(.*)\])?\n([\s\S]*?)\n:::$/gm, (_, type: string, label: string | undefined, text: string) =>
      [`**${label ?? type[0].toUpperCase() + type.slice(1)}**`, '', ...text.split('\n')].map((line) => (line ? `> ${line}` : '>')).join('\n'),
    )
    // Local images are build assets with hashed names, so they become their alt text.
    .replace(/!\[([^\]]*)\]\((?!https?:)[^)]+\)/g, (_, alt: string) => (alt ? `[Image: ${alt}]` : ''))
    // Relative links point back to the site.
    .replace(/(?<!!)\[([^\]]*)\]\((?!https?:|#)([^)\s]+)\)/g, (_, text: string, href: string) => `[${text}](${link(href)})`)
  // Text nested in components keeps their indent, which Markdown would read as code.
  if (entry.filePath?.endsWith('.mdx')) {
    let fence = false
    body = body
      .split('\n')
      .map((line) => {
        if (line.trimStart().startsWith('```')) fence = !fence
        return fence ? line : line.trimStart()
      })
      .join('\n')
  }
  body = body.replace(/\n{3,}/g, '\n\n').trim()
  const notice = entry.data.experimental && '> **Experimental.** This feature is new and may change between releases.'
  const head = [`# ${title}`, description && `> ${description}`, notice].filter(Boolean).join('\n\n')
  return new Response(`${head}\n\n${body}\n`, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
