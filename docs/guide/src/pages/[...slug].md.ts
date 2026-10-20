import type { APIRoute, GetStaticPaths } from 'astro'
import { getCollection, type CollectionEntry } from 'astro:content'

// Every guide page as plain Markdown at /<page>.md, for "Copy page" and for AI assistants to read.
export const getStaticPaths: GetStaticPaths = async () => {
  const pages = await getCollection('docs')
  return pages.map((entry) => ({ params: { slug: entry.id }, props: { entry } }))
}

export const GET: APIRoute<{ entry: CollectionEntry<'docs'> }> = ({ props: { entry }, site }) => {
  const { title, description } = entry.data
  // MDX imports mean nothing outside the site; relative links point back to it. Local images are
  // build assets with hashed names, so they become their alt text.
  const page = new URL(entry.id === 'index' ? '/' : `/${entry.id}/`, site)
  const body = (entry.body ?? '')
    .replace(/^import .+$\n?/gm, '')
    .replace(/!\[([^\]]*)\]\((?!https?:)[^)]+\)/g, '[Image: $1]')
    .replace(/(?<!!)\[([^\]]*)\]\((?!https?:|#)([^)\s]+)\)/g, (_, text: string, href: string) => `[${text}](${new URL(href, page)})`)
    .trim()
  const head = [`# ${title}`, description && `> ${description}`].filter(Boolean).join('\n\n')
  return new Response(`${head}\n\n${body}\n`, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
