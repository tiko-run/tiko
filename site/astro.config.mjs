// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

export default defineConfig({
  site: 'https://tiko.run',
  integrations: [sitemap()],
  // One page: its styles inline, so the first paint waits for no stylesheet request.
  build: { inlineStylesheets: 'always' },
})
