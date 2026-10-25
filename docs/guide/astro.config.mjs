// @ts-check
import { defineConfig } from 'astro/config'
import { readdirSync } from 'node:fs'
import starlight from '@astrojs/starlight'
import starlightSidebarTopics from 'starlight-sidebar-topics'
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
  // A fixed address for the newest release page, so links from the site never go stale.
  // The roadmap moved to a public board; old links to the page land there.
  redirects: { '/whats-new/latest': `/${releases[0].slug}/`, '/roadmap': 'https://demo.tiko.run/p/IGoVOBKKIi7IE-kGjrckETccZclVnrCM' },
  integrations: [
    starlight({
      title: 'tiko',
      // MDX pages get code styles as a file, since inline styles break inside <Tabs>; Head.astro loads it before a page swap.
      expressiveCode: { styleOverrides: { codeFontSize: '0.875rem' } },
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
      // Marks pages flagged experimental in the sidebar (src/routeData.ts).
      routeMiddleware: './src/routeData.ts',
      components: {
        Head: './src/components/Head.astro',
        Header: './src/components/Header.astro',
        PageTitle: './src/components/PageTitle.astro',
        Sidebar: './src/components/Sidebar.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      plugins: [
        // One sidebar per tab of the top bar.
        starlightSidebarTopics([
          {
            id: 'docs',
            label: 'Docs',
            link: '/',
            icon: 'open-book',
            items: [
              { label: 'Get started', items: ['index', 'why', 'install', 'quick-start'] },
              {
                label: 'Features',
                items: ['home', 'adding-tasks', 'what-you-can-add', 'working-together', 'search', 'keyboard-shortcuts'],
              },
              {
                label: 'Modules',
                items: [
                  // A nested group folds open under its static section title.
                  {
                    label: 'Gantt',
                    collapsed: true,
                    items: [
                      { slug: 'gantt', label: 'Overview' },
                      'gantt/stages',
                      'gantt/columns-and-filters',
                      'gantt/working-time',
                    ],
                  },
                  'focus-and-timers',
                ],
              },
              { label: 'Trackers', items: ['trackers', 'jira-data-center', 'jira-cloud', 'github-issues'] },
              {
                label: 'Self-hosting',
                items: ['configuration', 'data-and-upgrades', 'updates', 'security', 'privacy', 'monitoring', 'demo'],
              },
              { label: 'Project', items: ['architecture'] },
            ],
          },
          {
            id: 'whats-new',
            label: "What's new",
            link: '/whats-new/',
            icon: 'rocket',
            items: [
              { slug: 'whats-new', label: 'Overview' },
              { label: 'All releases', items: releases },
            ],
          },
        ]),
      ],
    }),
  ],
})
