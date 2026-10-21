# Writing the guide

The guide at docs.tiko.run is [Starlight](https://starlight.astro.build). Pages live in `src/content/docs/`, the sidebar in `astro.config.mjs`. Run it with `npm run dev` in this folder.

Most of a page is plain prose. Use the elements below when they make the page quicker to scan, not to decorate it.

| Element | Use it for | How |
|---|---|---|
| Table | Options, variables, commands: anything read by row | Markdown table |
| Callout | One thing the reader must not miss: a data loss, a requirement, a tip that saves time | `:::note`, `:::tip`, `:::caution`, `:::danger`, with a title in `[...]` |
| Tabs | The same step done differently per system or method | `<Tabs syncKey="os">` with `<TabItem label="Linux">`; `.mdx` only |
| Steps | An ordered procedure of three or more steps | `<Steps>` around a numbered list; `.mdx` only |
| Cards | Links to the pages that continue a topic | `<CardGrid>` with `<LinkCard>`; `.mdx` only |

- At most a callout or two per screen. Two in a row read as noise.
- No headings inside tabs: the table of contents and search would point into a hidden panel. Every tab stays in the HTML, so search engines and the page's Markdown twin see all of them.
- Tabs with the same `syncKey` switch together across the page. Use the same labels everywhere: `Linux`, `macOS`, `Windows`.
- `experimental: true` in a page's frontmatter adds an EXP badge in the sidebar and a notice under the title.
- Sidebar sections (Features, Modules) are fixed headings. A group nested in a section folds open; give it `collapsed: true` and an `Overview` page first.
- When a section moves to another page, add its old anchor to `MOVED` in `src/components/Head.astro`, so old links still land.
