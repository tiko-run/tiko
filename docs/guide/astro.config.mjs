// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://docs.tiko.run',
  integrations: [
    starlight({
      title: 'tiko',
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
      components: { PageTitle: './src/components/PageTitle.astro' },
      sidebar: [
        { label: 'Get started', items: ['index', 'install', 'quick-start'] },
        {
          label: 'The board',
          items: ['adding-tasks', 'working-together', 'search', 'keyboard-shortcuts'],
        },
        { label: 'Modules', items: [{ slug: 'gantt', label: 'Gantt' }, 'focus-and-timers'] },
        { label: 'Trackers', items: ['trackers', 'jira-data-center', 'github-issues'] },
        {
          label: 'Self-hosting',
          items: ['configuration', 'data-and-upgrades', 'security', 'monitoring', 'demo'],
        },
        { label: 'Project', items: ['roadmap', 'architecture'] },
      ],
    }),
  ],
})
