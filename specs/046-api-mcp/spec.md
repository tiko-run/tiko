# Feature Specification: Public API and MCP server

**Status**: Approved at G1 and G2 on 2026-11-10.

**Input**: People want to drive their boards from an AI agent (create boards, lay out tasks, add notes, ask what is on a board) and to build on tiko: scripts, bots, chat integrations. They also ask for an agent that answers about status and reads the gantt.

## Why

- Today only the web app talks to tiko, over a session cookie and an internal API that changes with every release. A script, a bot or an AI agent has no stable way in.
- Which fog does this clear: the board is reachable from where the person already works (the terminal, their agent, a script). They can ask "what is stuck on the release board" and get an answer from live cards, or say "put the sprint on a board grouped by status" and see the result instead of building it by hand.
- What this spec does not give yet: the gantt and Planning over the API, which the request about status and the gantt also asks for. Modules come back as kind, place and title only; reading gantt rows is the first follow-up once v1 holds.

Principles check:

| Principle | How the feature passes it |
|---|---|
| Truth | A read refreshes cards the same way an open board does, and every card says when it was fetched. Nothing is written to the tracker. |
| Clarity | "Give your AI agent a link and a key, and it can read and arrange your boards." |
| A fresh angle | The agent sees the board as the person laid it out: frames, arrows and neighbours, not a flat list. |
| Room to arrange | The agent arranges only when the person asks it to, and only the elements named in the request. tiko never rearranges anything by itself. |
| Calm | No notifications and no new UI noise on the board. |
| Trust | Keys are personal, tied to one workspace, limited to chosen boards if the person wants, expiring and revocable; an admin decides whether keys exist at all; an agent cannot overwrite or remove what people made; tiko itself calls no AI provider. |

## Decisions

### What the API is

1. **One public API, the MCP server on top of it.** `/api/v1/` is the public, versioned contract. The internal `/api/*` the web app uses stays free to change and is not documented as public. The MCP server at `/api/mcp` calls the same domain operations as `/api/v1/`, in process, and offers a small set of tools built for an agent (Decision 15). An MCP tool is a thin wrapper over a v1 operation, so the two cannot drift.
   - Under `/api/`, MCP is covered by the nginx location, the sign-in gate and the workspace guard that already exist. Outside it, the workspace guard skips the path and storage falls back to the default workspace (`api/workspace.py`, `adapters/storage/postgres.py`).
   - Rejected: MCP without an API. It leaves scripts and integrations with nothing.
   - Rejected: MCP tools generated one to one from the OpenAPI document. Dozens of fine-grained tools make agents choose worse and fill their context.
   - Rejected: exposing the board document as the web app stores it (xyflow nodes, whole-board `PUT` with a version). An agent would have to read the whole board and send it back, losing what people changed meanwhile.

2. **tiko runs no model.** tiko makes no request to any AI provider and needs no AI key. The person's own agent (Claude, ChatGPT, Cursor, a local model) connects to tiko. Board content leaves tiko only in answers to a key a person made, and the key dialog and the docs say plainly that it then goes wherever that person's agent sends it. The brief's Won't line "LLM" becomes "An LLM inside tiko".

3. **Boards only, never the tracker.** The API reads tasks and writes board elements. It never creates, edits or moves a task in Jira, GitHub or CalDAV. The brief's Won't "Two-way sync" stands.

### Keys

4. **Personal API keys, each tied to one workspace.** A person creates keys in Settings → API keys:
   - Making a key asks for the person's current password, so a stolen browser session cannot turn into months of access. Wrong answers count against the same limit as sign-in, so the dialog cannot be used to guess the password.
   - Each key has a name, a scope (Decision 6), its boards (Decision 7) and an expiry of 7, 30, 90 (default) or 365 days. No key lives forever. Settings shows "expires in N days".
   - The key is shown once, as `tiko_` plus 40 random base62 characters. Only its SHA-256 hash is stored, as with sessions. The list shows name, scope, boards, the first 4 characters after the prefix, created, expires and last used (to the day). At most 20 live keys per person.
   - A key belongs to the workspace it was made in. Every request with it runs in that workspace, with the person's role there. A key never reaches another workspace, whatever board id it names.
   - **Only granted roles count.** An admin acts as owner on every board in the web app; with a key every person, an admin too, acts as a member and reaches only boards they own, are a member of, or that are shared with everyone. Limits that depend on who the person is, such as the board limit, still follow their real role.
   - A demo visitor cannot make keys, and a demo instance (`TIKO_DEMO`) offers none.

5. **When a key stops working.** At once in the process that handled the change, and in the others within 30 seconds (the same bound sessions have today), when:
   - the person revokes it, or it expires;
   - the person is disabled, removed from the key's workspace, or signs out everywhere;
   - the password is reset through a reset link.
   A password the person changes themselves keeps the keys, and the confirmation says "N API keys stay active" with a button to revoke them.

6. **Two scopes.** `read`: boards, elements and task search. `write`: `read` plus creating boards and adding and changing elements within the rules of Decision 11.

7. **A key reaches all the person's boards, or only chosen ones.** A key made for chosen boards reads and writes only those; boards made with it are added to its list. A key for all boards does not write to a board with a public link; to write there, the board must be chosen for the key by name. This keeps an agent that was talked into it by text on a board from copying private content onto a public page.

8. **What a key can never do**: manage keys, change the account or password, share a board or change its members, public links, transfer, delete or restore a board, tracker credentials, any workspace or server setting. A key on any route outside `/api/v1/` and `/api/mcp` answers `401 auth_required`, as if it were absent; the test enumerates the app's routes, so a future route is covered without being listed.

9. **The admin decides whether keys exist.** Settings → Workspace gets "API keys", per workspace. It is on for a new install and off on a server that existed before the update; a workspace made later on such a server starts with it off too. Whether members may send shared boards to an outside agent is the admin's choice, not an update's. Off: nobody can make a key, and every key of the workspace answers `403 api_disabled` within the 30-second bound of Decision 5; keys are kept, so switching it on restores them. The admin sees how many live keys exist, never their values.

10. **How a request is signed in.** The sign-in gate checks `Authorization: Bearer` on `/api/v1/` and `/api/mcp` before it looks at the cookie, and never falls through to the cookie there. The cookie is not accepted on those paths, so the public API has no CSRF surface; there are no CORS headers. A person who must change their password is refused with a key too. A missing or bad key answers `401` with `WWW-Authenticate: Bearer` and a message that names Settings → API keys. nginx answers `404` on `/.well-known/oauth-*`, where MCP clients look after a `401`, instead of the web app's page with `200`.

### Writing to a board

11. **What a key may change.**
    - Add elements: notes, text, shapes, frames, cards, arrows.
    - Move, resize and put into a frame any element.
    - Change text and colour, and remove, only elements added through the API (by any key of the same person). People's own text is never overwritten and their elements never removed by a key: a change by the server is in nobody's undo history and a board has no history, so this is what keeps an agent's mistake recoverable by hand.
    - A removal that would take a person's arrow or timer with it is refused with `409`.
    - Changing the text or colour of, or removing, an element locked by a running vote answers `409 vote_running` instead of a success that the vote then undoes. Moving it is allowed, as in the web app.
    - Which elements were added through the API is kept in a server table (board, element, person), not in the board document: copies a person makes are not marked, and the web app needs no change.

12. **A batch is all or nothing.** Each call adds or changes up to 200 elements. A new room operation applies it: it builds the board as it would be after the batch, checks it with the rules every save uses (frame order, arrow ends, at most 2000 nodes and 4000 edges), and only then writes the touched keys into the board's shared document. A batch that breaks a rule changes nothing and answers `422` with the reason. The operation runs in the process that holds the board's room; a call that lands elsewhere is forwarded the way a REST save is today, with a message of its own. People with the board open see the change at once; no board version is needed.

13. **Retries are safe.**
    - The caller may give each new element its own id: `[A-Za-z0-9-]{1,64}`, not one of the names `Object.prototype` holds (the browser keeps elements in plain objects). The id must be free among both elements and arrows of the board.
    - Adding an id that the same person already added through the API answers success with the element as it is now, even if someone moved it since. Any other existing id answers `409`.
    - `create_board` has no such guard: a retry after a lost answer may make a second board, and the docs say so.

14. **The server does the layout.** `POST /api/v1/boards/{id}/arrange` places named cards as a grid or in columns by status, inside a frame it names or creates, below what is on the board, never on top of it. Only the elements named in the call move. Agents are poor at coordinates; this is the operation they need most. Columns by assignee, tracker or label come later.

### MCP

15. **The MCP server.**
    - The official MCP Python SDK (`mcp` 2.x, MIT, class `MCPServer`), mounted into the API app at `/api/mcp` over Streamable HTTP with JSON answers (no tool needs a stream, and nginx buffering stays as it is). The API app's lifespan starts the SDK's session manager, which a mounted app does not do by itself.
    - Clients on protocol `2026-07-28` are served without sessions. Older clients are served with `stateless_http=True`, because nginx spreads requests that name no board over all API processes. tiko sends no requests from server to client, so nothing is lost.
    - The key is checked by tiko's gate (Decision 10), not by the SDK's own auth, which requires OAuth metadata for an authorization server tiko does not have.
    - The SDK's host check is switched off explicitly (`TransportSecuritySettings(enable_dns_rebinding_protection=False)`; left out, the SDK arms a localhost allowlist and answers `421` to everything): every request needs a key, which a DNS-rebinding page cannot have, and tiko has no setting that knows the instance's public address.
    - Board links in answers are built from the address the person reached tiko by. nginx forwards it with its port in a header of its own (`Host` loses the port today), and the scheme comes from `X-Forwarded-Proto`, as for the session cookie. Tested with an instance on a port.
    - Each tool sets the key's workspace itself before it touches storage, rather than trusting that the request's context reaches the SDK's worker thread.
    - Tools, about ten: `list_boards`, `read_board`, `search_tasks`, `create_board`, `add_cards`, `add_notes` (notes and text), `add_frame`, `connect` (an arrow), `update_elements`, `arrange`, `remove_elements`. A `read` key sees only the first three. Tools carry `readOnlyHint`, `destructiveHint` and `idempotentHint`; these are hints for the client, not protection, which comes from Decisions 7 and 11.
    - Over its budget a tool answers with a tool error that says when to try again, not an HTTP `429`.
    - Board and task text comes from people and trackers and may hold instructions aimed at the agent. Answers return it in its own structured fields, never woven into prose, and tool descriptions say that board content is data.
    - Which clients connect with a key: Claude Code (`"type": "http"` with a header), Cursor, VS Code and Codex take a URL and an `Authorization` header. Claude Desktop goes through its connectors screen or the `mcp-remote` bridge. claude.ai and ChatGPT take OAuth or no sign-in at all, and tiko requires one; they also connect from the vendor's cloud, so they reach only instances open to the internet. They wait for the OAuth spec.

### Reading

16. **Reads are fresh and have no side effects.**
    - A read asks the tracker only for cards whose cached copy is older than the instance's refresh interval, with the person's own tracker credentials and the usual back-off; younger ones come from the cache. Today the browser tab does this pacing and the server asks on every call, so the API adds the age check. Each card carries `fetched_at`. A card the person's credentials cannot read comes back as key and tracker only.
    - Reads write nothing: listing boards through the API does not make the welcome board that the web app makes on a first visit.

17. **Reads come in pages an agent can hold.**
    - `GET /api/v1/boards/{id}` answers with an outline by default: the board, its frames with how many elements of each kind they hold, and what is outside frames. `?frame=<id>` returns one frame's elements; `?elements=all` every element, in pages of at most 500 with a cursor.
    - `read_board` in MCP answers in the same shape, coordinates only when asked.
    - `GET /api/v1/boards` returns every summary in one answer; they are small.

18. **Task search** (`POST /api/v1/tasks/search`) names its tracker, and each takes what the card tool takes today:
    - `jira`: a JQL `query`;
    - `demo`: words of the title;
    - `caldav`: words of the title across every list the person shows, and whether to include done tasks;
    - `github` has no search in tiko: a GitHub card is added by its key or link, which the add operation already takes.
    One call returns up to 100 tasks; there are no further pages, as in the card tool. Search has a budget of its own, smaller than other reads, because it spends the person's tracker quota.

19. **The public shape of a board.** Elements have a `kind` with stable public names that do not follow the stored document: `card`, `note` (a sticky), `text`, `shape`, `frame`, `arrow`, `image`, `module`, `timer`. A card carries its `key` and `source` and, read-only, the task's `title`, `status`, `assignee`, `due`, `url` and `fetched_at`. `image`, `module` and `timer` are read-only in v1 (kind, place, title). A board carries two flags: whether it has a public link, and whether it is shared with everyone.

### Limits, errors, contract

20. **Limits.** Budgets per minute per person, whatever key they use, smaller for writes and for task search than for other reads, kept in the database store the sign-in attempts use, so several API processes share them. Requests with a wrong key have a budget per address. Over a budget the answer is `429` with `Retry-After`. Batches hold up to 200 elements; a request body up to 1 MB. The numbers are in the contract.

21. **Errors** keep the body tiko already uses (`{"error": {"code", "message"}}`). The contract lists every code v1 answers with, including the existing ones (`invalid_request`, `board_limit`, `invalid_jql`, `task_not_found`, `tracker_rate_limited` and the tracker sign-in codes). On v1 a tracker's sign-in failure never answers `401`, which on a bearer API reads as a bad key and starts OAuth discovery in MCP clients: it answers `403 tracker_unauthorized`, without `WWW-Authenticate`, and the message says to reconnect the tracker in Settings. Every answer carries `X-Request-Id`, which tiko already sends.

22. **v1 only grows.**
    - Within v1 fields, kinds, operations and error codes are added, never removed or changed in meaning. A new required request field counts as a breaking change. Clients must ignore fields, kinds and codes they do not know; the contract says so.
    - A breaking change makes v2. v1 then keeps working at least six months, and the CHANGELOG says so. `Deprecation` and `Sunset` headers are added when v2 exists.
    - The OpenAPI document of v1 (`/api/v1/openapi.json`) holds only v1 routes, declares the bearer scheme and is committed with the spec in normalised form. A test fails when the served document differs from the committed one in a way that is not an addition.

## Requirements

- **FR-001**: A person MUST be able to create (after confirming their password), list and revoke API keys in Settings with a name, a scope, boards and an expiry of at most 365 days; the key MUST be shown once and stored only as a hash.
- **FR-002**: A key MUST work only in its workspace, with the person's granted roles there and without the admin override.
- **FR-003**: A key MUST stop working in every API process within 30 seconds of the events in Decision 5.
- **FR-004**: The session cookie MUST NOT authorise `/api/v1/` or `/api/mcp`; a key on any other route or the live socket MUST be treated as absent. The check MUST cover every route of the app, not a list.
- **FR-005**: An admin MUST be able to switch API keys off for the workspace; off by default after the update on existing installs, on for new ones.
- **FR-006**: A key for chosen boards MUST reach only those; a key for all boards MUST NOT write to a board with a public link that was not chosen for it.
- **FR-007**: Board reads MUST return the public shape of Decision 19 in pages (Decision 17), with cards refreshed as Decision 16 says, and MUST write nothing.
- **FR-008**: Task search MUST take Jira, demo and CalDAV queries as Decision 18 says and use the person's own credentials; a read MUST NOT ask the tracker for a card younger than the refresh interval.
- **FR-009**: A `write` key MUST be able to create a board and add and change elements in batches of up to 200, applied to the live board so open browsers see them without reload; a batch that breaks a board rule MUST change nothing.
- **FR-010**: A key MUST NOT change the text or colour of, or remove, an element not added through the API; a removal that would take a person's arrow or timer with it MUST be refused.
- **FR-011**: Retries MUST be safe as Decision 13 says.
- **FR-012**: `arrange` MUST place only the named cards, as a grid or in columns by status, without overlapping elements already on the board.
- **FR-013**: `/api/mcp` MUST serve the tools of Decision 15 to clients on protocol `2026-07-28` and to older ones, on an instance with several API processes, under any host name the instance is reached by.
- **FR-014**: Budgets MUST hold across API processes and answer `429` with `Retry-After` (a tool error in MCP).
- **FR-015**: The committed OpenAPI document of v1 MUST match the served one; a non-additive change MUST fail the tests.
- **FR-016**: tiko MUST make no outbound request to an AI provider.

## Testing

- **Domain tests**: key creation and password confirmation under the sign-in limit, hashing, expiry, every event of Decision 5, scopes, chosen boards and the public-link rule, the admin without override, the change and removal rules with arrows, timers and a running vote, idempotent ids, all-or-nothing batches, the layouts of `arrange`, reads without the welcome board, a read within the refresh interval that does not reach the tracker.
- **Workspace tests**, through v1 and through MCP: a key made in workspace A never reads or writes in B, by board id or otherwise; removing the person from A stops the key; an admin of A has no override with a key.
- **Links**: an instance reached on a port returns board links with that port.
- **API tests**: every route of the app outside v1 and MCP, enumerated from the app, answers a valid key with `401`; a cookie on v1 and MCP is refused; a key on the live socket is refused; a revoked key stops in another process within the bound (the multi-process setup live boards use); `/.well-known/oauth-protected-resource` answers `404`.
- **Live test**: an element added through the API reaches a browser connection already open on the board, and a person's concurrent edit of another element survives.
- **MCP tests** with the SDK's own client: a `read` key lists three tools; a call on a second process without stickiness succeeds; a request under a host name other than localhost is served. Both protocol versions, if the SDK's client can be pinned to the older one; otherwise the older one by hand with a client that speaks it.
- **Contract test**: FR-015.
- **By hand**: Claude Code, Cursor and Codex connected to a local stack with made-up boards: "lay out the open tasks of the demo project by status", "what is in progress on board X", "add a note under frame Y". Recorded in the slice PR.
- `make check`, `make smoke` (a v1 read and write added to `scripts/smoke.py`), `make licenses` with the MCP SDK.

## Slices

1. `api-keys`: Decisions 4–10. Key storage with workspace, boards and the API-made table's neighbour schema; Settings → API keys with password confirmation; the admin switch; the gate branch; revoke messages across processes; `GET /api/v1/me`; the guide page "API keys"; CHANGELOG.
2. `api-read`: Decisions 16–22 for reads. Boards and board outline with pages, task search, refresh on read, budgets, the OpenAPI document and its contract test, the guide page for the API.
3. `mcp-read`: `/api/mcp` with the three read tools, the `/.well-known/oauth-*` 404, the guide page "Connect your AI agent" (Claude Code, Cursor, VS Code, Codex; Claude Desktop through its connectors screen). `THIRD_PARTY.md`.
4. `api-write`: Decisions 11–13. The new room operation and its forwarding message, the API-made table, create board, add, change and remove, the write tools.
5. `api-arrange`: Decision 14, the layout constants shared with the frontend, the `arrange` tool.

Follow-ups, each its own spec: gantt and Planning reads; OAuth for claude.ai and ChatGPT. Chat integrations need nothing built in: a bot or a flow calls `/api/v1/` with a key.

## Notes for the plan

- `api/gate.py`: the bearer branch goes before the cookie on `/api/v1/` and `/api/mcp`; `/metrics` already reads a bearer token there.
- `api/workspace.py`: requests with a key take the key's workspace, not the board's or the person's. `role_in` serves only as the membership check; with a key the person's role is `member`, since `effective_role` makes an `admin` owner of every board (`domain/members.py`).
- `domain/refresh.py`: `RefreshService.refresh` asks the tracker on every call and holds one lock across a process's polls; the interval only scales back-off. The API path adds the age check of Decision 16.
- `frontend/nginx.conf.template` sends `Host $host`, which drops the port; forward `$http_host` in a header of its own for links.
- The workspace is a context variable set around the ASGI call (`api/workspace.py`); MCP tools set `in_workspace` from the key themselves.
- `domain/sessions.py` drops revoked sessions from the cache across processes by the raw token (`end_session`, `adapters/live/workers.py`). Keys need a message carrying the hash.
- `domain/live.py` `LiveDoc.write` makes the document equal to the state it is given, removing what is missing. The batch operation must write only the touched keys and validate before writing; the room's `repair` fixes silently and does not roll back, so it cannot give all-or-nothing on its own.
- `adapters/live/rooms.py` `LiveRooms.put` blocks on the event loop's result; MCP write tools are plain `def`, which SDK v2 runs on a worker thread, never `async def`, or they deadlock.
- `api/deps.py` builds trackers from a `Request`; MCP tools need those builders split from FastAPI.
- `frontend/api-workers.envsh`: add `^/api/v1/boards/<id>` to the board routing; MCP calls carry the board id in the body and rely on forwarding.
- Default card and note sizes live in the frontend; `arrange` needs them on the server as one shared constant.
- The image will carry both `httpx` and the SDK's HTTP client; check the size.

## Out of scope

- Writing to trackers (Decision 3).
- An LLM, AI keys or AI features inside tiko (Decision 2).
- Gantt contents, Planning, votes, reactions, timers and image uploads through the API.
- Outgoing webhooks (tiko calling a URL when a board changes).
- Finer scopes than read and write, an audit log of key use beyond "last used".
- CORS for browser apps on other sites.
- Client libraries (SDKs) for the API.
- A restore point of a board before an agent's writes.

## Changes to docs/brief.md

- Won't: "LLM" → "An LLM inside tiko: tiko calls no AI provider; people connect their own agent through the API and MCP".
- Next: a line for this spec.
