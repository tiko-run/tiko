// Files the site serves next to its pages: the installers and brand pictures of this checkout,
// and the redirects that keep tiko.run/<guide page> working, as when the whole domain led to
// the guide.
import { copyFileSync, readdirSync, writeFileSync } from 'node:fs'

const DOCS = 'https://docs.tiko.run'

const copies = {
  'install.sh': '../install/install.sh',
  'install.ps1': '../install/install.ps1',
  'favicon.svg': '../brand/app-icon/favicon.svg',
  'apple-touch-icon.png': '../brand/app-icon/apple-touch-icon.png',
  'og.png': '../brand/social/site-share.png',
}
for (const [name, source] of Object.entries(copies)) copyFileSync(source, `public/${name}`)

// /demo is the demo itself, not the guide's page about it; a page of the site keeps its own path.
const own = new Set(readdirSync('src/pages').map((file) => file.replace(/\.astro$/, '')))
const pages = readdirSync('../docs/guide/src/content/docs')
  .map((file) => file.replace(/\.mdx?$/, ''))
  .filter((page) => page !== 'index' && page !== 'demo' && !own.has(page))
  .sort()

const lines = [
  '/demo https://demo.tiko.run/demo 302',
  '/demo/* https://demo.tiko.run/demo 302',
  ...pages.flatMap((page) => [
    `/${page} ${DOCS}/${page}/ 302`,
    `/${page}/ ${DOCS}/${page}/ 302`,
  ]),
]
writeFileSync('public/_redirects', `${lines.join('\n')}\n`)
