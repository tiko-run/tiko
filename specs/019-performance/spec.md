# Feature Specification: Performance of live boards

**Feature Branch**: `019-performance`

**Created**: 2026-10-13

**Status**: Owner asked on 2026-10-13 for a spec that holds the measurements and every slice of the optimization, to be closed one by one, with one measurement at the end: the owner decided on 2026-10-13 not to measure after every slice.

**Input**: [baseline.md](baseline.md): a load test and a profile of one instance on a 1 vCPU host.

## Why

A team board is the product: thirty people on one canvas with a thousand elements. Today the reference host holds one such room, and only while the board is small. Two rooms on big boards are already three times over the limit we set for "it feels live".

The owner's aim is an instance that carries about 3000 people at once, 30 to a board, on boards of 1000 elements and more: 100 rooms. The baseline is one. The distance is two orders of magnitude, and the profile says most of it is not the language but two habits of the server: it sends every pointer frame to every recipient on its own, and it re-reads the whole board after every edit.

## How it is accepted

A slice is accepted the usual way: its tests, `make check`, and a look at its own number on a local stack where one exists (`/metrics` shows the time of a check and the messages sent). The reference setup is not rented for it.

The whole spec is accepted by one measurement at the end, slice P6: the baseline again with the same scripts on the same reference setup ([scripts/load](../../scripts/load/README.md)). A step passes when a pointer and an edit reach the others in a room within 150 ms at p95, a board opens within 2 s at p95 and there are no errors. The result goes into `results.md` next to the baseline. The expectations below are estimates from the profile; that measurement decides. What it shows as useless is taken out then.

## Decisions

1. **Order by the profile, cheapest first.** Compression and batching of presence go before anything structural: together they sit in 70% of the core.
2. **The wire protocol stays y-websocket.** A slice may send fewer frames, never a frame the web app of the previous release cannot read. A change that needs both sides ships the reading side one release earlier.
3. **No rewrite of the server in another language in this spec.** The CRDT is already native code. It comes back as a question only if the remeasure still shows the glue as the ceiling.
4. **SQLite stays.** Nothing in the baseline points at the database: the wait for it was under a millisecond.
5. **The browser is its own spec.** Drawing 1000 elements while 30 people move is not measured here and is not fixed here.
6. **Limits stay honest.** `MAX_CONNECTIONS` and `MAX_NODES` are raised only after a measurement at the new value passes.

## Slices

| # | Slice | What changes | Expected | Size |
|---|---|---|---|---|
| P1 | `perf-ws-compression` | Sockets of live boards are not compressed per message | 8 to 15% of the API's core back, less work for nginx | one line |
| P2 | `perf-presence-batch` | Presence of a room leaves as one frame every 50 ms instead of a frame per pointer move and recipient | Frames out fall several times; aimed at the 70% | small |
| P3 | `perf-incremental-check` | After an edit the server checks the elements that changed, not the board | A check of a 1000-element board goes from 150 ms to a few | medium |
| P4 | `perf-metrics-under-load` | `/metrics` answers while the event loop is saturated | Monitoring keeps seeing an overloaded instance | small |
| P5 | `perf-workers` | Several API processes, a board always served by the same one | Capacity grows with the cores | large |
| P6 | `perf-remeasure` | The whole baseline again, tables A to C, on the final code | The comparison this spec ends with | half a day |
| P7 | `perf-socket-path` | The proxy stops costing a quarter of the host for sockets | Up to 25% of the host's CPU | only if P6 still shows it |

### P1: no compression of socket frames

uvicorn compresses every WebSocket message. A presence frame is about 170 bytes of JSON that changes in a few digits; the profile shows 15% of the core in `permessage_deflate`. Turned off at the server's start. The web app needs no change: the extension is negotiated.

**Accept**: a socket opened by the web app carries no `permessage-deflate` in the answer to its upgrade. At the remeasure: the API's share of the core in table B, and the bytes on the wire, which will grow from the baseline's 5.3 Mbit/s for a room.

### P2: presence in batches

Today a pointer frame is relayed at once to all 30 sockets of the room. The server keeps the latest state of every tab already. It will mark a room as having news and send, every 50 ms, one frame with the states that changed since the last one. A tab still gets its own state back, which keeps a lone tab connected. Leaving a room is still told at once.

**Accept**: tests: a burst of pointer moves in a room becomes one frame for each recipient; in two browser tabs the other pointer and a dragged element still follow smoothly. At the remeasure: messages out per room fall from about 4000 a second to at most 600 (30 recipients, 20 frames), and a pointer still arrives within 150 ms at p95: the batch adds 50 ms at most.

### P3: check what changed

After a burst of edits the room reads the whole document out of the CRDT and validates every element, on the event loop. The update that triggered it names the keys it touched. The check will validate those elements and the rules that span elements (a parent that exists, the limits), keeping the last valid board as it does now. The save still writes the whole board; its cost goes to its own slice only if the measurement after P3 asks for it.

**Accept**: on a local stack with a 1000-element board `tiko_live_check_seconds` averages a small fraction of what it does before the change. At the remeasure: under 10 ms on the reference host, and table B, "1 room, 1000" passes on edits. The tests of repair (`tests/test_live_doc.py`, `tests/test_live.py`) stay green unchanged: the behaviour is the same, only the cost differs.

### P4: metrics under overload

Found at 4 rooms: no scrape got through. Since #138 the rendering is off the loop, but a request on the API's port still crosses the loop several times before it reaches the route, whatever the route does. So the metrics get a port of their own, `TIKO_METRICS_PORT`, served by a separate thread to the metrics token (the owner's choice on 2026-10-13). The loop's watcher keeps the gauges of rooms and sockets fresh four times a second, so that thread never reaches into the loop.

**Accept**: a test holds the event loop busy and `/metrics` still answers. At the remeasure: Prometheus gets every scrape at a step that fails.

### P5: several processes

One process uses one core. A room lives in the memory of its process, so a board must always reach the same one: the proxy picks the process by the board id in the path. What crosses processes today and has to be dealt with: signing a person out of every open board, the role changes that close sockets, the limiters of sign-in and demo, and the REST save that goes through an open room. SQLite in WAL mode serves several processes on one host.

**Accept**: tests with two processes: signing out everywhere still closes that person's sockets on every board, and a REST save reaches the tabs of a board open in the other process. At the remeasure: on a host with 4 cores the passing number of rooms is at least three times that of one process.

### P6: the remeasure

Tables A, B and C of the baseline again, same scripts, same reference setup, plus a host with 4 cores. `results.md` ends with the two columns side by side, what each slice turned out to be worth and what is still between the result and 100 rooms.

### P7: the socket path

nginx in the web container proxies every frame, on the same core as the API: a quarter of the host in the baseline. P1 and P2 shrink that traffic several times, so this may solve itself. It becomes work only if the remeasure still shows nginx over 10% of the host at the heaviest passing step. The options then, each with its own measurement and the owner's decision: tune nginx's buffers for sockets, or let the browser open the socket straight to the API.

## Out of scope

- The web app's rendering of big boards (decision 5).
- A room server in another language (decision 3).
- Postgres, more than one host, a shared bus between hosts.
- Runs of hours; chaos tests.
