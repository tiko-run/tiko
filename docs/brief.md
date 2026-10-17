# Brief: tiko

> Open-source infinite canvas for your tasks: live cards from your tracker, arranged the way you think

Filled in during Intake and Scope (gate **G1**) from [research.md](research.md). Structure: [docs/playbook/01-strategy.md](playbook/01-strategy.md).

## Hypothesis

The main hypothesis from the research (top by ICE): a lead will trust the canvas and manage their tasks on it only if card statuses update on their own. A spatially minded lead will open tiko every day because lists and kanban boards don't give them an overview of their tasks. We'll know by how often they open it and by manual refresh being almost unnecessary.

| Field | Answer |
|---|---|
| User | A lead, head or manager on Jira Data Center who keeps track of their own tasks and thinks spatially |
| Pain | Lists and kanban boards give no overview; tasks can't be "touched" and grouped. In boards with Jira (Miro) the status goes stale, cards get recreated by hand, and DC needs OAuth through an admin |
| Success signal | ≥ 4 early users open the board ≥ 4 days a week for two weeks in a row. Status lags Jira by ≤ 1 min. Self-rated "organization" and "keeping up" scores went up compared with the survey before the start |
| Kill criterion | After 2 weeks the early users are back to Jira filters, or polling DC through a PAT can't deliver fresh statuses without a load that admins complain about |
| Channel: how the first 100 users hear about it | The first 10–20: early users who asked for it. Then the OSS community |

## Core scenario

1. The user starts tiko (`docker compose up`), opens it in the browser and enters the Jira DC URL and their PAT in settings.
2. Creates a board, draws frames and sticky notes, connects them with arrows.
3. Adds a task with the "Jira card" tool by key (`DEV-12`) or by pasting a link. A compact card appears on the canvas: type icon, key, title, status.
4. Drags cards into frames, collapses them to the key, and clicks to expand a mini-card (assignee, priority, updated, link to Jira).
5. Changes the task status in Jira. Within ≤ 1 min the card on the board shows the new status. A closed task is struck through. The board is saved and reopens looking the same.

## Scope

**Must**
- Core scenario end-to-end
- xyflow canvas: pan, zoom, frames (groups), sticky notes and text, arrows with binding, selection and dragging
- Jira DC card: add by key or URL, collapsed and expanded states, mini-card on click
- Automatic status updates: batched JQL polling every 30–60 s for the cards on the open board, a "Refresh all" button, an "updated N s ago" indicator
- Provider behind an interface (`resolve`, `poll`), only Jira DC implemented
- The PAT is stored only on the backend, encrypted, and never reaches the browser
- Boards are saved on the backend (SQLite), multiple boards
- Self-host: `docker compose up`, README with setup in ≤ 10 min

**Should** (at most 1)
- Pasting a JQL query: tasks are laid out on the canvas in a batch

**Next** (after ship, [specs/002-modules](../specs/002-modules/spec.md))
- Modules: interactive blocks on the canvas, added from a picker, built on one module host so new kinds plug in. First module: Gantt with live task bars, scale, quarters, milestones and dependency lines. Plan dates live on the board only.
- Focus timer and background music ([specs/003-focus](../specs/003-focus/spec.md)): a pomodoro capsule over the board with built-in CC0 lofi tracks and the user's own files; browser-only, no backend.
- Instance password ([specs/007-instance-password](../specs/007-instance-password/spec.md)): every instance asks for a password: from ENV, or generated on first start and printed to the log; the Railway template generates it.
- Team mode ([specs/008-accounts](../specs/008-accounts/spec.md) is step 1), for companies that want a Miro-like board inside their network: accounts and roles with a Jira PAT per user, board sharing, real-time editing with cursors (CRDT), then OIDC SSO and Postgres. Stays a monolith.
- Several trackers at once ([specs/013-task-sources](../specs/013-task-sources/spec.md) is step 1): tasks from different trackers on one instance and one board, each task knowing its tracker and showing its logo on a mixed board. GitHub Issues ([specs/015-github-issues](../specs/015-github-issues/spec.md)) reads public issues and pull requests without a key; Jira Cloud follows as a provider.
- Planning mode ([specs/027-planning](../specs/027-planning/spec.md)), off by default: Gantt rows cut into stages with people, one list of people per instance with their time off, columns that inherit down the task tree, saved filters, a person's workload across boards. Money and capacity come later.
- Selection bar ([specs/023-selection-bar](../specs/023-selection-bar/spec.md)): one bar next to whatever is selected, with only the properties every selected element shares: fill, opacity, outline, text size and bold.

**Won't**
- Confluence, Todoist (only a hook in the provider interface)
- Two-way sync: changing status and editing a task from the board
- Jira webhooks
- Freehand drawing and shapes outside the fixed pack ([specs/022-shapes](../specs/022-shapes/spec.md))
- Payments
- i18n: English-only interface
- LLM
- Mobile version

## Stack

- Backend: FastAPI
- Frontend: React/TS + `@xyflow/react`
- Profile: `oss`, AGPL-3.0-only license with a CLA (dual licensing kept open for a hosted version), self-host (`compose.release.yml`)
- LLM: none

## Risks

| Risk | Plan B |
|---|---|
| xyflow can't deliver whiteboard UX (frames, sticky notes, selection) and feels like a graph editor | Prototype the canvas as the first slice. If it doesn't feel right, build a Plait (Drawnix) prototype in a day and decide before the second slice |
| DOM rendering slows down on 200+ cards | Collapsed cards by default, `onlyRenderVisibleElements`, benchmark on a 300-node board |
| DC admins object to frequent polling, or there is a rate limit | One batched JQL per board, `updated >= -2m`, poll only the open board, interval configurable in settings |
| Demand for a personal tool isn't confirmed beyond the founder | Validate with the team before going to the community. Kill criterion above |
| The PAT leaks through logs or the bundle | Encryption on disk, key from env, masking in logs, a test that the API never returns the token |
