# Feature Specification: Performance of live boards, second round

**Feature Branch**: `021-performance-2`

**Created**: 2026-10-13

**Status**: Approved at G1 and G2 on 2026-10-13. The owner asked for a spec that fixes what the remeasure of spec 019 found and ends with an answer: is this stack at its limit, and if so, which part of it. The slices go in the order below. On 2026-10-13, after R3, the owner changed that order: R4 is not built, R6 goes next, R5 waits for the remeasure (see "The order after R3").

**Input**: [results of spec 019](../019-performance/results.md), its [baseline](../019-performance/baseline.md), and a reading of how tldraw, Figma, Excalidraw and the Yjs servers do the same job (sources under "What others do").

## Why

Spec 019 took one core from one room of 30 people to four or five, and four cores to 20 rooms: 600 people. The aim is still 100 rooms, 3000 people. The remeasure also showed where the next limits are, and none of them is the one the first round worked on:

- The host runs out before the Python process does. At the last passing step the API process is idle for 44% of the time; nginx takes 16 to 20% of the host and the kernel's network path most of the rest.
- Of what the process does, more than half is one call per frame and recipient. Presence is batched since 019, edits are not.
- The save writes a whole board and goes from 23 ms to 190 ms as the host fills.
- Many single visitors meet the database before the CPU: one connection per process, a write lock at the start of every transaction, and a cost that grows with the data.
- The measurement itself is weak in places: one run per row on a shared vCPU, and a row at the knee differed several times between runs.

The owner's question behind this spec: after it, either the stack carries the aim, or there is a measured case for replacing a part of it (SQLite, the socket layer, the proxy, Python in the room). No part is replaced on a guess.

## How it is accepted

019 measured once at the end. That left P1 inseparable from P2 and one table unreadable. This round:

- **A slice** is accepted by its tests, `make check`, and its own number on a local stack, before and after, written into the slice's task.
- **The reference run** at the end repeats tables A to C of 019 on the same setup. Every row is run three times and the median is reported with the spread. A row is compared with the code of 019's end run on the same VM on the same day, not with a number from another day.
- **A step passes** as before: a pointer and an edit within 150 ms at p95, a board open within 2 s at p95, no errors.
- **The verdict** (slice R8) is a table: for each part of the stack, the numbers its trigger below names, as measured in R7, and whether the trigger was met. The parts are measured in different units (a share of the host, a share of the process's samples, a wait in milliseconds), so they are not added up into one scale.

Decided at G2: the reference run is on DigitalOcean again. The targets get cores of their own where the account offers them, and a third target with 8 cores shows whether rooms keep growing with cores.

## Decisions carried over from 019

1. The wire protocol stays y-websocket. A slice may send fewer frames, never a frame the web app of the previous release cannot read.
2. Limits stay honest: `MAX_CONNECTIONS` and `MAX_NODES` are raised only after a measurement at the new value passes.
3. The browser is its own spec.
4. One host. Several hosts, a shared bus and a database server are the subject of the verdict, not of the slices.

## What others do

| Practice | Who | Source |
|---|---|---|
| Presence and document changes leave in one frame per recipient on a tick; the first message goes at once | tldraw: 60 Hz on the server, 30 Hz from the client | `DATA_MESSAGE_DEBOUNCE_INTERVAL` in `packages/sync-core/src/lib/TLSyncRoom.ts`, [tldraw/tldraw](https://github.com/tldraw/tldraw) |
| Save what changed, snapshot rarely | tldraw: a row per changed record, a full snapshot every 8 s. Figma: a journal about every 0.5 s, a checkpoint every 30 to 60 s | `SQLiteSyncStorage.ts` in tldraw; [Making multiplayer more reliable](https://www.figma.com/blog/making-multiplayer-more-reliable/) |
| Append updates, compact later | y-redis; Hocuspocus and y-sweet debounce the store by 2 to 10 s | [yjs/y-redis](https://github.com/yjs/y-redis), [ueberdosis/hocuspocus](https://github.com/ueberdosis/hocuspocus) |
| A room lives in one process and the route goes to it | tldraw, Figma, Liveblocks | [tldraw sync](https://tldraw.dev/docs/sync) |
| Pointers at 10 Hz with interpolation in the client | Liveblocks; tldraw, Excalidraw and Figma send 30 Hz | [How to animate multiplayer cursors](https://liveblocks.io/blog/how-to-animate-multiplayer-cursors) |
| Presence that may be dropped for a slow client | Excalidraw | [excalidraw-room](https://github.com/excalidraw/excalidraw-room) |
| A native room server | Figma: Rust made serialization of large files over 10 times faster. It did not buy faster fan-out | [Rust in production at Figma](https://www.figma.com/blog/rust-in-production-at-figma/) |

Nobody publishes what a reverse proxy costs in front of a socket server with this fan-out. Our own 16 to 20% is the best number there is, so that slice is measured, not looked up.

Routing by board is already what 019's P5 does. The 20 Hz of presence sits between the two camps.

## Slices

Ordered by what a crowd meets first, then by cost.

| # | Slice | What changes | Expected | Size |
|---|---|---|---|---|
| R0 | `perf2-measure` | Runs that can be trusted: repeats and a median, two versions on one VM, the CPU of each container, the time of each kind of database transaction | A row means the same thing twice | small |
| R1 | `perf2-db-readers` | Reads stop waiting for writes | The wait for the database back under a millisecond with many single visitors | medium |
| R2 | `perf2-metrics-cost` | What a scrape costs, and less of it | To be measured first | small |
| R3 | `perf2-socket-path` | A cheaper path between the proxy and the API (019's P7) | A part of the 16 to 20% of the host back | small trial, then decided |
| R4 | `perf2-edit-batch` | Edits leave in the room's tick, merged | Not built: there is almost nothing to merge | – |
| R6 | `perf2-presence-rate` | Fewer presence frames in a busy room, smooth pointers in the client | Presence frames halved when a room is busy | small |
| R5 | `perf2-incremental-save` | A save writes what changed | A save of a 1000-element board in a few milliseconds whatever the load | medium; only if R7 asks for it |
| R7 | `perf2-remeasure` | Tables A to C again, by the rules above | The comparison | half a day |
| R8 | `perf2-verdict` | The table of limits and triggers | The answer to the owner's question | small |

### The order after R3

Before R4 was built its premise was checked against 019's results. A room of 30 sent 643 to 650 messages a second, 600 of them presence and about 45 edits: edits arrive less than once in a tick, so merging them in the tick has almost nothing to merge. "The half of the process that sends" sends presence. What the host runs out of is frames, and the one slice that takes frames away is R6. So:

- R4 is not built. It comes back only if a profile after R6 shows edits.
- R6 goes next.
- R5 is the largest slice, with a change of the stored format, and the save took a few percent of a core in 019. It is built only if R7 shows the save in the way.

### R0: runs that can be trusted

What the 019 run had to improvise goes into `scripts/load`: a driver that runs a step, repeats it, and prints the median and the spread; the same step against two images in turn; the CPU of the API and the web container from their cgroups for the window. The API reports the time a transaction holds the database by its kind, so the one that grows with the data has a name.

**Accept**: on a local stack the same step run three times prints a median and a spread; `/metrics` shows the database time by kind.

### R1: reads do not wait for writes

Today a process has one SQLite connection behind a lock, and since 019 every transaction takes the write lock at its start, reads included. WAL allows readers next to a writer; the server does not use that. Plan: a connection for reads (or a few), the write lock only for transactions that write, and whichever query R0 shows growing with the data gets its index or goes away. The limiters of 019 write on requests; R0 tells whether that matters.

**Accept**: a test with a held write shows a read answering meanwhile. Locally, with a database of several thousand people and their boards, the wait for the database at 500 single visitors is under a millisecond on average. At the remeasure: table A on four cores passes at a number set after R0, on a database that is not empty.

### R2: the cost of a scrape

In table A the runs without Prometheus were all at the fast end: two runs, a hint. The scrape refreshes a gauge from the database and renders every metric under the interpreter's lock.

**Accept**: the same step with and without a scrape every 5 s, three runs each. A difference above the spread → the scrape is made cheaper (the gauge from memory, the rendering less often) until it is inside the spread.

### R3: the socket path

In order, each with its measurement, the owner deciding after each:

1. nginx reaches the API over a Unix socket in a shared volume instead of the bridge network.
2. The host's network for both containers, as a compose option for Linux.
3. The browser opens the socket of a board straight on the API. It costs TLS and a port per process, and the one-command install; proposed only if 1 and 2 leave nginx over 10% of the host.

**Accept**: for each option, the web container's share of the host and the rooms that pass, next to today's.

### R4: edits in the tick (not built)

A room already wakes every 50 ms for presence. Updates of the document that arrive within a tick are merged into one update (`merge_updates` of Yjs) and sent once per recipient; the first one after a quiet time goes at once, as tldraw does. One WebSocket frame still carries one y-websocket message, so the web app of the previous release reads it.

**Accept**: tests: a burst of edits in a room becomes one frame for each recipient, and the documents of all tabs converge. An edit still arrives within 150 ms at p95. At the remeasure: messages out per room, and the share of sending in the profile.

### R5: a save writes what changed

Today the whole board is written on every save. Plan: the updates of a board are appended as they come; a full snapshot replaces them when the room goes quiet or every N seconds; loading is the snapshot plus the updates after it. What it touches: the format in the database and its migration, the REST save, export, the copy made before a migration.

**Accept**: tests: a board restored from a snapshot and its updates equals the live one, after a restart in the middle too. Locally `tiko_live_save_seconds` on a 1000-element board is a few milliseconds. At the remeasure: the save does not grow with the load.

### R6: presence under load

A room with 10 sockets or more sends presence at most once in 100 ms; a smaller one keeps its 50 ms. The first state after a pause still leaves at once. What a tab sends does not change.

The web app already moves pointers and dragged elements evenly between two frames, over 80 ms. It now measures the gap between the frames it gets and takes 160 ms when they come half as often, so it follows the room without being told the rule. The spec first asked for the web app to learn this a release ahead of the server. It ships in the same release instead: the two come in one image, and a tab of the previous release left open reads every frame as before; its pointers only pause for a moment between two frames until it is reloaded.

A pointer that keeps moving does not arrive later for it: the room sends the latest state of a tab, and a tab sends one every 50 ms, so what leaves is at most that old. Only a second move right after a lone first one may wait up to 100 ms.

**Accept**: tests: a busy room holds a burst back for its own delay, a small one does not; the web app takes the longer move once frames come half as often. Two tabs: the other pointer moves smoothly at 10 Hz. Locally, presence frames out of rooms of 30 halve.

### R7 and R8: the remeasure and the verdict

R7 is 019's P6 by the rules of "How it is accepted", plus the target with 8 cores. R8 writes `results.md` and the verdict:

| Part | It is the limit when | Then |
|---|---|---|
| SQLite | After R1 the wait for the database is still what stops single visitors while cores are free; or the aim needs several hosts | A spec for a second storage adapter behind the same port |
| The socket layer of uvicorn | After R3 and R6 the API process, not the host, is full, and sending is still over half of it | A prototype of another server for the socket of a board, measured on table B |
| Python in the room | The prototype above does not move the limit either | A spec for a native room core; the CRDT is native already |
| The proxy | After R3 nginx is still over 10% of the host | The owner decides on the direct socket |
| Nothing | The aim is met, or the limit is the number of cores | Size the host; the spec ends |

Each "then" is a new spec with its own G1. This spec builds none of them.

## Out of scope

- Postgres, several hosts, a shared bus: named in the verdict, not built here.
- The web app's rendering of big boards.
- A room server in another language: the same.
- Runs of hours.
