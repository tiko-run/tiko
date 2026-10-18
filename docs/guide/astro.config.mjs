// @ts-check
import { defineConfig } from 'astro/config'
import { readdirSync } from 'node:fs'
import starlight from '@astrojs/starlight'
import { byNewest } from './src/lib/releases.mjs'

// Release pages are named 2026-10-21; the sidebar shows them as versions, newest first.
const releases = readdirSync(new URL('./src/content/docs/whats-new/', import.meta.url))
  .filter((file) => file.endsWith('.mdx'))
  .map((file) => file.slice(0, -4))
  .sort(byNewest)
  .map((name) => ({
    slug: `whats-new/${name}`,
    label: name.replaceAll('-', '.'),
  }))

export default defineConfig({
  site: 'https://docs.tiko.run',
  integrations: [
    starlight({
      title: 'tiko',
      // Inline, not a separate file: ClientRouter applies a newly added stylesheet a frame late.
      expressiveCode: { emitExternalStylesheet: false, styleOverrides: { codeFontSize: '0.875rem' } },
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: true,
      },
      description: 'User guide for tiko, an open-source infinite canvas for your tasks.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/tiko-run/tiko' }],
      editLink: { baseUrl: 'https://github.com/tiko-run/tiko/edit/main/docs/guide/' },
      customCss: [
        '@fontsource-variable/ibm-plex-sans',
        '@fontsource-variable/jetbrains-mono',
        './src/styles/tiko.css',
      ],
      components: {
        Head: './src/components/Head.astro',
        Header: './src/components/Header.astro',
        PageTitle: './src/components/PageTitle.astro',
      },
      sidebar: [
        {
          label: "What's new",
          items: [
            { slug: 'whats-new', label: 'Overview' },
            { label: 'All releases', collapsed: true, items: releases },
          ],
        },
        { label: 'Get started', items: ['index', 'why', 'install', 'quick-start'] },
        {
          label: 'The board',
          items: ['adding-tasks', 'working-together', 'search', 'keyboard-shortcuts'],
        },
        { label: 'Modules', items: [{ slug: 'gantt', label: 'Gantt' }, 'focus-and-timers'] },
        { label: 'Trackers', items: ['trackers', 'jira-data-center', 'jira-cloud', 'github-issues'] },
        {
          label: 'Self-hosting',
          items: ['configuration', 'data-and-upgrades', 'updates', 'security', 'privacy', 'monitoring', 'demo'],
        },
        { label: 'Project', items: ['roadmap', 'architecture'] },
      ],
    }),
  ],
})
