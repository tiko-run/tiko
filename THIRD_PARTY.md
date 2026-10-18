# Third-party components & AI usage

## Open-source libraries

| Component | License | Purpose |
|---|---|---|
| FastAPI | MIT | HTTP API |
| Pydantic / pydantic-settings | MIT | Validation, config from ENV |
| uvicorn | BSD-3 | ASGI server |
| prometheus-client | Apache-2.0 | Metrics |
| sentry-sdk | MIT | Error reports from the API, off unless an admin turns them on |
| httpx | BSD-3-Clause | HTTP client for Jira Data Center |
| cryptography | Apache-2.0 / BSD-3-Clause | Fernet encryption of the Jira token |
| pycrdt | MIT | Shared document (CRDT) of a live board on the server; bundles Yrs (MIT) |
| React | MIT | UI |
| driver.js | MIT | Product tour, loaded only when the tour runs |
| @sentry/browser | MIT | Error reports from the page, loaded only when they are on |
| Vite | MIT | Build |
| Tailwind CSS | MIT | Styles |
| shadcn/ui, cn | MIT | Components, theme, class merging |
| Radix UI | MIT | Accessible primitives for shadcn |
| lucide-react | ISC | Icons |
| Octicons `mark-github` (inlined SVG path) | MIT | GitHub icon in the About panel |
| Jira icon (`frontend/src/sources/marks/jira.svg`, from `@atlaskit/logo` 23.3.1) | Apache-2.0 for the file; the mark is a trademark of Atlassian, used unchanged under its [trademark guidelines](https://www.atlassian.com/legal/trademark) | Marks tasks that come from Jira |
| simple-icons 16 (devDependency of `site/`) | CC0-1.0 for the files; each mark is a trademark of its owner, shown unchanged in its brand color to name trackers on the landing page | Logos of trackers other than Jira and GitHub on tiko.run |
| GitHub mark (`frontend/src/sources/marks/github.svg` and `github-dark.svg`, the `mark-github` icon of GitHub's Octicons) | MIT for the files; the mark is a trademark of GitHub, used unchanged in black and in white under its [logo policy](https://docs.github.com/en/site-policy/other-site-policies/github-logo-policy) | Marks tasks that come from GitHub |
| React Flow (@xyflow/react) | MIT | Infinite canvas, nodes and edges |
| Yjs, y-websocket, y-protocols, lib0 | MIT | Shared document (CRDT) of a live board in the browser and its WebSocket sync |
| IBM Plex Sans (@fontsource-variable/ibm-plex-sans) | OFL-1.1 | UI font; outlined in the logo and covers in `brand/` |
| JetBrains Mono (@fontsource-variable/jetbrains-mono) | OFL-1.1 | Monospace font for task keys |
| fake-indexeddb | Apache-2.0 | IndexedDB in frontend tests (dev only) |
| class-variance-authority, tw-animate-css | Apache-2.0 / MIT | Component variants, animations |
| TanStack Query | MIT | Server state |
| zod | MIT | API response validation |
| react-hotkeys-hook | MIT | Keyboard shortcuts |
| sonner | MIT | Toasts |
| marked | MIT | Markdown → HTML for legal pages at build time |
| pip-licenses | MIT | Python dependency license check (`make licenses`) |
| license-checker-rseidelsohn | BSD-3-Clause | npm dependency license check (`make licenses`) |
| fontTools, brotli, uharfbuzz, resvg-py | MIT / MIT / Apache-2.0 / MIT | Outline text and render PNG in `brand/generate.py` (run by hand with `uv run --with`, not shipped) |

Full list with versions: lock files (`backend/uv.lock`, `frontend/package-lock.json`).

## Models and external APIs

| Model / API | Provider | How it is used |
|---|---|---|
| Jira Data Center REST API v2 | the user's own Jira instance | Reads issue fields with the user's personal access token |
| tiko usage stats collector | Cloudflare Workers and Neon Postgres (EU), run by the tiko project | Receives the install event and the daily ping described in the guide's Usage stats page; off with `TIKO_USAGE_STATS=false` |
| GitHub REST API | github.com | Reads issues and pull requests of public repositories, without a token or with the server's read-only `GITHUB_TOKEN` |

## Data

| Dataset | Source | License | Note |
|---|---|---|---|

## Templates

## Music

Bundled in `frontend/public/music/`, re-encoded to MP3 112 kbps. All CC0 (public domain), no attribution required; credited anyway.

| Track | Author | License | Source |
|---|---|---|---|
| Laundry On The Wire, Keeping Cool, First Snow, 2 Hour Delay | HoliznaCC0 | CC0 | [Lo-Fi and Chill collection](https://opengameart.org/node/161819) |
| Families, Autumn | HoliznaCC0 | CC0 | [Chill Beats Collection](https://opengameart.org/content/chill-beats-collection) |
| Lofi Hip Hop Loop | omfgdude | CC0 | [OpenGameArt](https://opengameart.org/content/lofi-hip-hop-loop) |

- Project skeleton and methodology — [launchpad](https://github.com/Smacktur/launchpad).
- User guide site — [Astro](https://github.com/withastro/astro) and [Starlight](https://github.com/withastro/starlight) (MIT), with the IBM Plex Sans and JetBrains Mono packages above, built in CI and served from GitHub Pages, not shipped with the app. Astro pulls in [sharp](https://github.com/lovell/sharp) (Apache-2.0) with prebuilt libvips (LGPL-3.0-or-later) for build-time image processing.
- Landing page (`site/`) — [Astro](https://github.com/withastro/astro) and its sitemap integration (MIT), icons from [lucide-static](https://github.com/lucide-icons/lucide) (ISC) inlined at build time, the same two fonts and the tracker marks above, built in CI and served from Cloudflare Pages, not shipped with the app.

## AI development tools

| Tool | Used for |
|---|---|
| Claude Code | Code generation, debugging, docs |
| OpenAI Codex | Parallel development, cross-review |
| GitHub spec-kit | Spec, plan, tasks (`specs/`) |
| gstack | Scope and architecture review, QA, security |
| context7 MCP | Up-to-date library docs |
| marketingskills (MIT, Corey Haines) | Marketing skills for `/grow`: product context, customer research, copy, creators, referrals, communities, directories; local agent tooling, not shipped in the repository |
| Hallmark (MIT), Impeccable (Apache-2.0) | Design skills: UI generation and critique; local agent tooling, not shipped in the repository |
| Playwright MCP, Chrome DevTools MCP, shadcn MCP | UI checks in the browser, components |
