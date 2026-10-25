# Research: tiko, an open-source canvas with live Jira Data Center cards

> Date: 2026-10-05 · Timebox: ~25 min (4 streams in parallel) · Recommendation: **go** (as a personal tool for a lead, self-hosted, Jira DC)

## TL;DR

- Jira cards on a board are already sold by Miro, Lucidspark and Mural, including for Data Center. Atlassian Whiteboards and FigJam work only with Cloud. We found no open-source self-hosted "canvas + live Jira DC cards" solution.
- The best-confirmed pain is stale cards. In Miro the status doesn't update on its own; you have to press update manually or recreate the card. The threads have been open for years.
- There is demand for boards in DC (137 votes for `CONFSERVER-83249`, Atlassian doesn't plan to build it), but it is about team work. For our persona ("I think spatially, kanban doesn't fit") there are no direct quotes; this is a hypothesis.
- Engine: tldraw is out because of its license, and there are no living forks from the Apache era. xyflow (React Flow, MIT) fits best: a card is a React node, groups and arrows with binding work out of the box. Freehand drawing we'd have to write ourselves.
- First we build a Jira DC card by key through a PAT that updates itself (polling every 30–60 s), plus frames and dragging.

## Solutions and competitors

| Product | What it does | Model / price | Strengths | Weaknesses (from reviews) | Link |
|---|---|---|---|---|---|
| Miro + Jira Cards | Jira cards on a board, Cloud, Server and DC | SaaS, Starter $8, Business $20 per member per month | Closest in features, DC via OAuth 2.0 and webhooks | Status doesn't update on its own, manual update needed for each card, users ask for "Refresh all". DC needs an admin. Users report the app getting slower ([thread](https://community.miro.com/ask-the-community-45/miro-has-become-too-slow-9139)) | [Jira Cards](https://help.miro.com/hc/en-us/articles/360017572434-Jira-Cards), [not updating](https://community.miro.com/ask-the-community-45/jira-cards-are-not-updating-18974), [status update idea](https://community.miro.com/ideas/important-feature-for-jira-integration-status-update-4403), [pricing](https://comparedge.com/tools/miro/pricing) |
| Lucidspark + Lucid Cards for Jira | Import of Cloud and DC tasks, two-way sync | SaaS, price not checked | Two-way sync | For DC an admin does the setup (OAuth) | [help](https://help.lucid.co/hc/en-us/articles/14943046626964-Integrate-Lucid-Cards-with-Jira), [admin](https://help.lucid.co/hc/en-us/articles/14942710266516-For-admins-Configure-Lucid-Cards-for-Jira) |
| Mural | Jira cards, two-way and bulk sync, DC supported | SaaS, price not checked | DC supported | The Server integration is legacy | [Mural Jira](https://www.mural.co/integrations/jira), [Server legacy](https://support.mural.co/s/article/using-the-jira-server-integration) |
| Confluence Whiteboards | Native boards with Jira cards | Included in Confluence Cloud | Native, a sticky note turns into a task | Cloud only, not planned for DC. A card can't be resized or restyled | [docs](https://support.atlassian.com/confluence-cloud/docs/link-jira-issues-from-your-whiteboard/), [CONFSERVER-83249](https://jira.atlassian.com/browse/CONFSERVER-83249), [resize](https://community.atlassian.com/forums/Confluence-questions/Resize-or-Stretch-the-Display-Cards-ticket-from-Jira-in/qaq-p/2630727) |
| FigJam + Jira widget | Jira widget on a board | Included in Figma | Designer ecosystem | Cloud only, on-prem not planned | [widget](https://www.figma.com/community/widget/1094001923188252679/jira), [forum](https://forum.figma.com/suggest-a-feature-11/widget-for-figjam-to-jira-server-integration-27867) |
| Easy Agile TeamRhythm, StoriesOnBoard | Story map on top of the Jira backlog | Easy Agile $10 per month for 10 people, SoB $9–55 per user | Server and DC supported | Rigid grid, no free canvas | [Easy Agile](https://marketplace.atlassian.com/apps/1212078/easy-agile-teamrhythm-user-story-map-retrospectives), [SoB](https://www.capterra.com/p/138042/StoriesOnBoard/) |
| Obsidian + Jira Issue and Issue Manager | Jira cards and sync inside notes | OSS, free | Local, has a dependency graph | These are notes, not a spatial board. Could not confirm it works in Canvas | [Jira Issue](https://community.obsidian.md/plugins/obsidian-jira-issue), [jira-graph](https://github.com/marc0l92/obsidian-jira-graph) |
| Excalidraw, AFFiNE, Penpot | OSS boards, self-host available | OSS | Free, self-host | No Jira integration. In Excalidraw the request was closed as out of scope | [excalidraw#1189](https://github.com/excalidraw/excalidraw/issues/1189), [AFFiNE](https://affine.pro/blog/best-open-source-miro-alternatives) |

Takeaways:

- Paid SaaS covers the job for teams and planning sessions. The gap is elsewhere:
  - no free personal self-hosted tool;
  - for DC everyone requires OAuth through an admin, and nobody supports a PAT;
  - cards don't update on their own.
- We differ in three ways: a PAT without an admin, auto-update with "Refresh all", and a compact card like the Confluence macro.

## Demand

| Signal | Strength | Source |
|---|---|---|
| `CONFSERVER-83249` "Confluence whiteboards available for DC/on-prem": 137 votes, 77 watchers, "Gathering Interest" since 2023-04-21, updated 2026-08-14 (checked via API) | 🟢 | [CONFSERVER-83249](https://jira.atlassian.com/browse/CONFSERVER-83249) |
| People pay for Jira on a board: Miro, Lucid, Mural, Marketplace apps (191 installs for Advanced Agile Boards, Cloud only) | 🟡 | [Marketplace](https://marketplace.atlassian.com/apps/1224087/advanced-agile-boards-visual-whiteboards-for-jira) |
| Complaints about Jira cards in Cloud Whiteboards: can't change size, style, or add fields | 🟡 | [adjust card](https://community.atlassian.com/forums/Confluence-questions/Possibility-of-adjust-the-Jira-Card-in-the-Whiteboard/qaq-p/2868266), [style](https://community.atlassian.com/forums/Confluence-questions/Is-there-a-way-to-change-jira-card-style-in-whiteboards/qaq-p/2890327) |
| New "tasks on a canvas" products for spatial thinkers and ADHD (Fabric, Forma, Canmark): this is supply, not user voice | 🟡 | [Fabric](https://fabric.so/comparison/best-adhd-task-management-app), [Forma](https://apps.apple.com/us/app/forma-tasks-notes-on-canvas/id6755406356) |
| HN "jira whiteboard": 4 posts, 1–3 points each, 0 comments | 🔴 | [HN Algolia](https://hn.algolia.com/api/v1/search?query=jira%20whiteboard&tags=story&hitsPerPage=15) |
| A direct request for a personal self-hosted tool with Jira DC via PAT | 🔴 | not found |

Conclusion: 🟡. Demand for a "board with Jira in DC and on-prem" is confirmed, and people pay for Cloud solutions. The "lead's personal tool" segment is not directly confirmed: it rests on a hypothesis and on the founder.

## Voice of the user

| Pain / wish | Frequency | Quote | Source |
|---|---|---|---|
| Card status doesn't update | 🟢 | "status never updates in Miro even though I make changes in JIRA" | [Miro Community](https://community.miro.com/ask-the-community-45/jira-cards-bi-directional-sync-updates-made-in-jira-don-t-reflect-in-miro-1076) |
| The workaround is to recreate the card | 🟢 | "replacing the existing miro card with a new card with the latest status, but that beats the whole purpose of the integration" | [same thread](https://community.miro.com/ask-the-community-45/jira-cards-bi-directional-sync-updates-made-in-jira-don-t-reflect-in-miro-1076) |
| Manually reconciling the board with Jira | 🟢 | "we have to manually compare the sprint board with the user storyboard if all stories for the last release are done" | [Miro Ideas](https://community.miro.com/ideas/important-feature-for-jira-integration-status-update-4403) |
| A tool without auto-update is not fit for use | 🟡 | "Miro isn't fit for purpose if it doesn't auto update" | [Miro Community](https://community.miro.com/ask-the-community-45/jira-cards-are-not-updating-18974) |
| DC behind an external URL doesn't connect to SaaS | 🟡 | "we use an external URL (different from Base URL) for integration purposes due to security reasons" | [Miro Ideas](https://community.miro.com/ideas/accept-external-jira-urls-for-jira-data-center-miro-integration-9281) |
| Miro gets slower | 🟢 | "The Miro app has gotten significantly slower and slower over the past year." | [Miro Community](https://community.miro.com/ask-the-community-45/miro-has-become-too-slow-9139) |
| "I think spatially, kanban doesn't fit" | 🔴 | not found (Reddit and HN are not indexed by search) | hypothesis |

## Canvas engine

| Engine | License | React card | Frames and groups | Arrows with binding | Maturity | Verdict |
|---|---|---|---|---|---|---|
| tldraw 4.x and 5.x | proprietary, key required in production | best API | yes | yes | 5.5.2 | ❌ not OSS ([license](https://tldraw.dev/community/license)) |
| tldraw 2.0 alpha (up to `3cf4dae3`) | Apache-2.0 forever ([blog](https://tldraw.dev/blog/license-update-for-the-tldraw-sdk)) | yes | yes | yes | 2023 code, no living forks (best: [compound](https://github.com/DallasCarraher/compound), 6★, last commit 2024-05) | ❌ we'd have to maintain it ourselves |
| **xyflow (React Flow)** | MIT | **yes, a node is a React component** | **yes, `parentId`, group** ([docs](https://reactflow.dev/learn/layouting/sub-flows)) | **yes** | 38.6k★, `@xyflow/react` 12.12.0 from 2026-09-24 | ✅ candidate #1 |
| Plait + Drawnix | MIT | not confirmed | not confirmed | not confirmed | Drawnix 14.9k★, Plait 0.x | 🟡 needs a one-day prototype |
| Excalidraw | MIT | no: custom elements were rejected ([#8184](https://github.com/excalidraw/excalidraw/issues/8184)), only an iframe is left | yes | yes | 133k★ | ❌ not suitable for a live card |
| BlockSuite (AFFiNE) | MPL-2.0 | web components, not React | yes | yes | last release 2025-07 | ❌ |

The main risk with React Flow: it is not a whiteboard. Freehand drawing exists only in a paid Pro example, so we'd have to build it on `perfect-freehand`. Nodes render in the DOM, which may be slow with hundreds of nodes ([whiteboard docs](https://reactflow.dev/learn/advanced-use/whiteboard)).

## Insights

1. All paid boards sync Jira cards on events or once an hour. Users have complained about stale status for years and recreate cards by hand. Opportunity: make "status is always fresh" the main feature, with batched JQL polling `key in (...) AND updated >= -2m` every 30–60 s plus "Refresh all". [Miro Community, Miro Ideas]
2. Competitors connect DC through OAuth with an admin involved, while DC often sits behind an external URL and a security policy. Opportunity: a user PAT and self-host inside the perimeter. It installs without a Jira admin and without sending data to a SaaS. [Miro DC OAuth, Miro Ideas external URL, CONFSERVER-83249]
3. The "board for DC" niche has sat at "Gathering Interest" at Atlassian for 3.5 years now (137 votes). A competitor from the ecosystem won't close it. [CONFSERVER-83249]
4. We don't need a "board with cards" but "cards with a board". So the foundation is a graph engine with React nodes (xyflow), and whiteboard features (shapes, freehand drawing) are built on top, not the other way around. [Stream D]

## Hypotheses (ICE)

| # | Hypothesis | I | C | E | ICE | How to test in the MVP |
|---|---|---|---|---|---|---|
| 1 | A spatially minded lead will manage their Jira DC tasks on the tiko canvas daily because lists and kanban don't give them an overview. We'll know by how often they open it (≥ 4 days a week, 2 weeks) | 9 | 4 | 7 | 252 | Self-dogfooding by the maintainer and early users. Session counter and a survey on an "organization, overview" scale before and after |
| 2 | A user trusts the board only if the status updates on its own. We'll know by manual "Refresh" being almost unused and the Jira discrepancy staying ≤ 1 min | 8 | 8 | 7 | 448 | Polling every 30–60 s, a manual refresh metric, status comparison |
| 3 | Team leads will install tiko themselves (`docker compose up` and a PAT), without a Jira admin. We'll know by 10–20 installs by early users within a month | 7 | 5 | 6 | 210 | Setup in ≤ 10 min from the README, active board counter |
| 4 | The OSS community will notice the project (stars, issues) after the first public posts | 5 | 3 | 6 | 90 | After v0.1.0. Outside the MVP |

## MVP map

- **First (Must):** xyflow canvas (pan, zoom, frames and groups, arrows, text and sticky note); a Jira DC card by key or URL through a PAT (type icon, key, title, status, collapse to key, mini-card on click); automatic status polling and "Refresh all"; boards saved on our own backend; a single user; `docker compose up`. Tests hypotheses #1 and #2.
- **Second (Should):** freehand drawing and simple shapes (rectangle, ellipse) on top of xyflow; JQL paste that lays out tasks in a batch.
- **Not doing:** real-time collaborative editing, Jira Cloud, Confluence and Todoist (the provider is behind an interface in code, but Jira only), two-way sync (changing status from the board), webhooks, auth and roles, mobile version, LLM.

## Recommendation

**go.** The gap is concrete and confirmed: there is no open-source self-hosted canvas with live Jira DC cards, and the main complaint about the leader (status doesn't update) is solved by a technique we're planning anyway. The main risk is that demand specifically for a lead's personal tool is not confirmed from outside. We test the MVP on ourselves and on the team (10–20 people) before going to the community. Engine: xyflow. Plait is worth checking only if a free-form whiteboard turns out to matter more than cards.

## Research limitations

- Reddit, HN (except one query) and X.com can't be read through search. There are no quotes about "spatial thinking".
- Prices for Lucid, Mural and FigJam and install counts for DC apps were not checked.
- The Miro page about webhooks for DC returned 403. The claim "once an hour with OAuth 2.0" comes from a retelling of a community thread and was not verified directly.
- Plait properties, Excalidraw frames and binding come from summaries; the documentation was not read.

## From the library

- No similar projects or evaluated canvas tools in the library.
- `vite-react-ts`: the template's frontend base, xyflow goes on top.
