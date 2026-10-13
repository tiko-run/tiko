# API Contract: Public link

Additions to the contract of [spec 008](../../008-accounts/contracts/api.md). Errors use the common body `{"error": {"code", "message"}}`.

## For people on the board

| Route | Who | Change |
|---|---|---|
| `GET /api/boards`, `GET /api/boards/{id}`, `POST /api/boards`, `PATCH /api/boards/{id}` | as before | each board gains `public: bool` |
| `GET /api/boards/{id}/members` | viewer and up | gains `public: bool` and `public_token: string \| null`; the token is sent to the owner (and an admin) only |
| `PUT /api/boards/{id}/public` | owner | body `{"public": bool}`, answers `{"public": bool, "public_token": string \| null}` |
| `GET /api/settings` | signed in | gains `public_links: bool` |
| `PUT /api/settings` | admin | accepts `public_links: bool` |

`PUT /api/boards/{id}/public`:

- `true` on a board that is already public keeps its token; two requests at once get the same one.
- `false` removes the token; the next `true` makes a new one.
- `true` while `public_links` is off answers 403 `forbidden`; `false` always works.

The page of a public board is `/p/{public_token}`.

## For guests

Open without a session. A session cookie, when the browser sends one, is ignored.

| Route | Answer |
|---|---|
| `GET /api/public/{token}` | `{room, name, updated_at, version, doc, tasks, refresh_interval_s}`; `room` is the last segment of the socket's path and tells nothing else about the board |
| `GET /api/public/{token}/version` | `{version, updated_at}`; a rename changes `updated_at` only |
| `POST /api/public/{token}/refresh` | `{tasks, fetched_at, sources}`, as `POST /api/boards/{id}/refresh` |

- `doc` is the board document as `GET /api/boards/{id}` returns it.
- With the demo tracker `tasks` holds the demo tasks in full, and `refresh` polls them.
- With any tracker that is read with a person's token every task comes as `{key, state: "private", url}` with the other fields empty, and `sources` is empty. `Task.state` gains the value `private`.
- An unknown token, a token that was turned off, a deleted board and an instance with `public_links` off all answer 404 `not_found` with the same body.
- More than 3000 requests a minute through one link answer 429 `too_many_attempts` with `Retry-After`. The limit is per link, not per address: the API runs behind proxies and does not see who is asking.
- No other method or path under `/api/public/` exists, except the socket below.

## Guest socket

`GET /api/public/{token}/live/{room}`, upgraded to a WebSocket (until spec 019 the path ended at `/live`; the proxy needs `room` to find the process that holds the board): the live document of [spec 009](../../009-realtime/contracts/live.md), for reading. No session is needed or used.

| Check | Result when it fails |
|---|---|
| The link opens a board (as `GET /api/public/{token}`) | accepted, then closed with 4403 |
| `room` is the one that board's `GET` returns | accepted, then closed with 4403 |
| The link's request budget | accepted, then closed with 4429 |
| Under 200 guests in the room | accepted, then closed with 4429 |

| From a guest | What happens |
|---|---|
| sync step 1 | answered with step 2 |
| sync step 2, update | dropped |
| awareness | dropped; nobody on the board learns of the guest |

The server sends sync step 1 on accept and then every document update. It never sends awareness to a guest. Nothing is sent on a quiet board, so the web app asks for sync step 1 every 20 s to keep the socket open.

| Close code | Meaning | What the web app does |
|---|---|---|
| 4403 | the link was turned off, the board was deleted or renamed, or public links were switched off; also sent when a check once a minute finds the link dead | reads `GET /api/public/{token}` again: 404 shows "This board is not available."; otherwise takes the new name and connects again after 1 s |
| 4429 | no free place for a guest | shows the board from `GET /api/public/{token}`, checks `/version` every 5 s, says "Many people are viewing this board. It updates every few seconds." and tries the socket again every 30 s |
| 1009, 1008 | a frame over 1 MiB, a frame that cannot be read | – |

Guests do not count toward the 30 connections of the people on the board, and people do not take guests' places. Each time the socket becomes live the page asks `/version` once, to catch a rename or a change made while it was connecting, and then stops asking. When the socket is not live for 5 s, or a reload asked for by a 4403 has not succeeded yet, it checks every 5 s as in slice 1 and shows what it reloads.

The server's own log never carries a token: the path of an accepted socket is written as `/api/public/***/live/{room}`.

## Headers of the page

`/p/*` is served with `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` and `Cache-Control: no-cache`.
