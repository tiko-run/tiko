# Feature Specification: Landing page at tiko.run

**Feature Branch**: `020-landing`

**Created**: 2026-10-13

**Status**: Owner approved the structure on 2026-10-13 (G1) and told the agent to build; the page is shown at G3 on a preview address before `tiko.run` is switched to it.

**Input**: Owner, 2026-10-13: "`tiko.run` should not redirect to the docs. Not a plain landing: something good-looking, with examples, so the launch plan works when the first traffic comes. Everything important in view, the demo one click away, the board simulation first in the hero, animation without overdoing it, a footer with links, SEO and AI search."

## Why

`tiko.run` answers with a redirect to the guide. A person who comes from a launch post lands on documentation: no picture of the product, no demo button, nothing to share. The landing is the first screen of the launch plan.

## Decisions

1. **A static site in `site/`**, built with Astro like the guide, with the tokens and fonts of `DESIGN.md`. It is not part of the web app and never reaches the tiko images.
2. **Hosted on Cloudflare Pages**, where the `tiko.run` zone already is. The guide stays on GitHub Pages at `docs.tiko.run`.
3. **The wow is the product.** `DESIGN.md` rules out marketing gradients, so the hero is a board: a simulation drawn with DOM and CSS on the board's own tokens, not the real canvas and not a video. It plays one scene in a loop, the visitor can drag its elements, and it stands still under `prefers-reduced-motion`.
4. **No runtime dependencies.** Motion is CSS and a small script; no animation library.
5. **Pictures are drawn in code.** Real screencasts replace the feature loops later, one block at a time.
6. **Scenarios instead of customer stories.** There are no public users yet; made-up quotes are not written.
7. **GitHub is shown as a link with its mark, without a star count**, until there is something to count.
8. **tiko Cloud is shown as "Coming soon"** with no form: collecting e-mail needs a privacy policy and a place to keep the addresses, which is a slice of its own.
9. **Old addresses keep working.** `tiko.run/install.sh` and `tiko.run/install.ps1` are served by the landing itself, copied from `install/` at build time. Every page of the guide and `/demo` redirect from `tiko.run/<path>` as they do today, through the site's own redirect file.
10. **No `llms.txt`** (playbook 11): the page is readable without JavaScript, answers questions in plain text and carries structured data instead.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A visitor understands tiko and tries it (Priority: P1) 🎯

A person opens `tiko.run` from a launch post. Without scrolling they read what tiko is, see a board that moves, and have two ways on: the demo and the install command.

**Independent Test**: open the page on a 1440×900 and a 390×844 screen in both themes. The headline, the "Try the demo" button, the install command and the board are in the first screen on desktop; on a phone the headline and both actions are, with the board right under them.

**Acceptance Scenarios**:

1. **Given** the page, **When** it loads, **Then** the hero shows the headline, one line under it, "Try the demo" leading to `https://demo.tiko.run/demo`, and the install command with a copy button.
2. **Given** the hero board, **Then** it plays the scene (cards appear from keys, a status changes on its own, bars grow on the Gantt, a timer goes off) and starts again.
3. **Given** the board, **When** the visitor drags a card, **Then** the card follows the pointer and the scene pauses; a "Replay" button starts it again.
4. **Given** `prefers-reduced-motion: reduce`, **Then** the board shows the finished scene and nothing moves on the page.
5. **Given** JavaScript is off, **Then** every text, link and the finished board are on the page.
6. **Given** the page, **Then** it has sections for trackers, features, scenarios, self-hosting, open source, questions and a footer with links to the guide, GitHub and the license.

### User Story 2 - Search engines, assistants and link previews read the page (Priority: P2)

**Independent Test**: fetch the built HTML without running scripts and run Lighthouse on the preview address.

**Acceptance Scenarios**:

1. **Given** the built page, **Then** it has one `h1`, a title and description written for a query, a canonical address, Open Graph and Twitter tags with a 1280×640 picture, and JSON-LD for the software and the questions.
2. **Given** the site, **Then** `robots.txt` allows search and assistant crawlers and names the sitemap, and `sitemap-index.xml` exists.
3. **Given** the preview address, **Then** Lighthouse gives at least 95 for performance, accessibility, best practices and SEO on mobile.

### User Story 3 - Old links keep working (Priority: P1)

**Independent Test**: on the preview address ask for `/install.sh`, `/install.ps1`, `/quick-start/`, `/demo` and a path that does not exist.

**Acceptance Scenarios**:

1. **Given** `/install.sh` and `/install.ps1`, **Then** the scripts of `main` are served.
2. **Given** the path of a guide page, **Then** the answer is a 302 to the same path on `docs.tiko.run`.
3. **Given** `/demo`, **Then** the answer is a 302 to `https://demo.tiko.run/demo`.
4. **Given** an unknown path, **Then** a 404 page with links to the home page and the guide.

## Requirements *(mandatory)*

- **FR-001**: The site MUST build to static files with `npm run build` in `site/`, and CI MUST build it on every change to `site/` or `install/`.
- **FR-002**: Colors, type, radius and the look of board elements MUST come from `DESIGN.md`, in a light and a dark theme, following the system theme with a switch.
- **FR-003**: The page MUST work without JavaScript and without motion.
- **FR-004**: The page MUST NOT load fonts, scripts or pictures from other hosts. The one exception is the Cloudflare Web Analytics beacon, which Cloudflare adds to the page at its edge; it sets no cookies.
- **FR-005**: Every name, key and task on the page MUST be made up.
- **FR-006**: The site MUST serve the installers and redirect guide paths and `/demo` (Decision 9).

## Success Criteria

- **SC-001**: Lighthouse on mobile: 95 or more in all four categories.
- **SC-002**: The first screen on desktop holds the headline, both actions and the board.
- **SC-003**: `curl -fsSL <preview>/install.sh | sh -s -- --help` prints the installer's help.

## Out of scope

- The e-mail list for tiko Cloud, a privacy policy and terms.
- Real screencasts, a blog, comparison pages, other languages.
- Switching `tiko.run` to the site: done by hand after G3, with the owner's word (DNS and the redirect rules of the zone).
