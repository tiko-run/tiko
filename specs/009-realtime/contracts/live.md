# Live Contract: Real-time boards

## Socket

`GET /api/boards/{id}/live`, upgraded to a WebSocket. Same origin, authenticated by the `tiko_session` cookie the browser sends with the upgrade; no token in the URL.

| Check at the upgrade | Result when it fails |
|---|---|
| Session (`PasswordGate`) | closed with 1008 before accept |
| `Origin` host equals the request host | closed with 1008 before accept |
| Role on the board at least viewer | accepted, then closed with 4403 |
| Under 30 connections in the room | accepted, then closed with 4429 |
| With several API processes (spec 019): the request reached the process that holds the board | accepted, then closed with 1012 |

## Messages

Binary frames of the y-websocket protocol, each starting with a varuint message type.

| Type | Message | From a viewer | From an editor or owner |
|---|---|---|---|
| 0, sync step 1 (0) | state vector | answered with step 2 | answered with step 2 |
| 0, sync step 2 (1) | missing updates | dropped | applied |
| 0, update (2) | document update | dropped | applied and sent to the others |
| 1, awareness | presence states | the tab's own state is sent to everyone, the sender included; states of other tabs in the message are dropped | the same |
| anything else | – | dropped | dropped |

Text frames are ignored. A frame over 1 MiB closes the socket with 1009.

The server sends sync step 1 on accept, then updates and awareness from the others, and its own repair updates.

Type 100 is the server's own, with no body: the instance's planning lists changed ([spec 027](../../027-planning/contracts/api.md)), so the tab reads `/api/planning` again. Only signed-in sockets get it; a guest reads the names from the board's public payload.

Awareness leaves in batches. The room sends one awareness message to every signed-in socket at most once in 50 ms, and at most once in 100 ms while it has 10 sockets or more: the latest state of each tab that changed, several tabs in one message. A state heard after a pause of that length leaves at once; one heard sooner waits for its turn, and states a tab replaced within that time are never sent. The web app does not know the rule: it measures the gap between the messages and moves pointers and dragged elements over 80 ms, or over 160 ms when they come about 100 ms apart. Two things do not wait: a socket that closes is told to the others at once, and a document update is sent after the awareness the server heard before it.

## Close codes

| Code | Meaning | What the web app does |
|---|---|---|
| 1001, 1006, 1012 | server going away, lost connection | reconnects with backoff up to 2.5 s |
| 1008 | no session or foreign origin | goes to sign-in |
| 1009 | message too big | reloads the board |
| 4401 | the session ended (sign out everywhere, password change, disabled, expired) | goes to sign-in |
| 4403 | the role on this board changed or is gone, or the board was deleted | reads `GET /boards/{id}` again: 404 goes to the board list with "You no longer have access to this board."; otherwise applies `my_role` and connects again |
| 4429 | the room is full | stays view-only on the last saved version with "This board is full right now.", tries again every 30 s |

Codes 4400–4499 are final for the provider: it does not reconnect on its own.

## Awareness state

One state per tab, set by the client, never stored.

```text
{
  user: {id, name, color},       // color: index 0–7 into the presence palette, from the person's id
  cursor: {x, y} | null,         // flow coordinates; null when the pointer is off the canvas
  selected: string[],            // node and edge ids, at most 200
  drag: {[nodeId]: {x, y}} | null  // absolute positions of nodes being dragged
}
```

## REST (changed)

| Method, path | Change |
|---|---|
| `GET /boards/{id}` | unchanged; `doc.viewport` is whatever was last stored and is ignored by the web app |
| `PUT /boards/{id}` | same request and response; a current `version` is applied to the shared doc as one update (people on the board see it), a stale one answers 409 `version_conflict` |
| `DELETE /boards/{id}`, member, everyone, transfer routes | unchanged; they also close or re-check the board's sockets |
| `PATCH /people/{id}`, `POST /auth/logout`, `POST /auth/logout-all`, `PUT /me/password`, reset accept | unchanged; they also close that person's sockets (logout: that session's) |

No new REST route and no new error code.
