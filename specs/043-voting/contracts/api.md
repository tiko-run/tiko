# API: votes

All routes need a signed-in person who can open the board (viewer or more); guests of a public link get none. Errors use the common body `{error: {code, message}}`.

| Route | Body | Answer | Errors |
|---|---|---|---|
| `GET /boards/{id}/votes` | – | `{running: Round \| null, past: [{id, name, started_at, ended_at, voted_count}]}` | 404 |
| `POST /boards/{id}/votes` | `{name, votes 1–99, stack, minutes 1–60 \| null, anonymous, elements[]}` | 201 `Round` | 403 viewer, 409 `vote_running` |
| `GET /boards/{id}/votes/{round}` | – | `Round` | 404 |
| `POST …/{round}/join` | – | `Round` | 409 `vote_closed` |
| `POST …/{round}/ballot` | `{element, delta: 1 \| -1}` | `Round` | 409 `vote_closed`, 422 `vote_refused` |
| `POST …/{round}/done` | `{done}` | `Round` | 409 `vote_closed` |
| `POST …/{round}/extend` | – | `Round`, a minute later | 403, 409 `vote_closed` |
| `POST …/{round}/end` | – | `Round` with results | 403, 409 `vote_closed` |
| `PATCH …/{round}` | `{name}` | `Round` | 403 |
| `DELETE …/{round}` | – | 204 | 403 |

`Round`: the settings, `started_by {id, name}`, `ends_at`, `ended_at`, `state`, the caller's `joined`, `done`, `mine {element: count}` and `left`, `joined_count`, `done_count`, `can_manage` (the starter or the board's owner), `still_voting` (names, for `can_manage` while it runs, else null), and after the end `results [{element, count, text, voters}]` (`voters` null when anonymous) and `voted_count`.

Only the starter and the board's owner extend, end, rename and delete. While a round runs nothing tells one person's votes or any totals to another.

The live socket sends message type `101` to the board's signed-in people when its votes change; the client reads `GET /boards/{id}/votes` again.
