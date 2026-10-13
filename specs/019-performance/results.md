# Results: the baseline again, on the final code

Measured on 2026-10-13 on the code of `main` after slices P1 to P5, with the scripts in [scripts/load](../../scripts/load/README.md) and the reference setup of [baseline.md](baseline.md): the target a Linux VM with 1 vCPU and 2 GiB, the generator a VM with 4 vCPU in the same private network. A second target with 4 vCPU and 8 GiB ran `TIKO_WORKERS=4`. Every step was held for 60 to 120 seconds. The load went through the web container, as a browser's does.

A step passes when a pointer and an edit reach the others in a room within 150 ms at p95, a board opens within 2 s at p95 and there are no errors.

## In short

- Rooms of 30 on boards of 1000 elements: one core holds 4 with room to spare and 5 at the edge. The baseline held one, at the edge. Four cores with four processes hold 20.
- The size of a board stopped mattering: 15 elements or 1000, the same number of rooms passes.
- Past its limit the instance gets slower and loses nobody. The baseline collapsed at 4 rooms with sockets closed; now 8 rooms on one core answer in 190 to 270 ms and every socket stays.
- Many small rooms did not get the same gain. On one core 200 boards pass and 500 sit at the limit. With more cores the next limit for them is the database, not the CPU.
- nginx takes 16 to 20% of the host at the heaviest passing step. P7 is asked for.

## B. Rooms of 30

`rooms.py`: 30 sockets on a board, 5 drag, 2 create and delete, 10 move the pointer at 20 frames a second, 13 watch.

One process, 1 vCPU:

| Rooms | Elements | Pointer p95, baseline | Pointer p95 | Edit p95, baseline | Edit p95 | Outcome |
|---|---|---|---|---|---|---|
| 1 | 15 | 18 ms | 59 ms | 17 ms | 28 ms | passes |
| 1 | 1000 | 156 ms | 58 ms | 263 ms | 25 ms | passes; was at the edge |
| 2 | 1000 | 515 ms | 61 ms | 513 ms | 30 ms | passes; failed |
| 4 | 1000 | 6.3 s | 70 ms | 6.5 s | 49 ms | passes; collapsed |
| 4 | 15 | 7.9 s | 67 ms | 7.7 s | 58 ms | passes; collapsed |
| 5 | 1000 | | 144 ms | | 147 ms | passes, at the edge |
| 6 | 1000 | | 196 ms | | 153 ms | fails, no socket lost |
| 8 | 1000 | | 234 ms | | 239 ms | fails, no socket lost |
| 8 | 15 | 6.1 s | 269 ms | 6.1 s | 243 ms | fails, no socket lost; collapsed |

A pointer in a quiet room now takes about 60 ms where it took 18: the batch of P2 holds a frame for up to 50 ms. That is the price of the slice and it stays inside the limit.

Four processes, 4 vCPU, `TIKO_WORKERS=4`:

| Rooms | Elements | Pointer p95 | Edit p95 | Host CPU busy | Busiest process | Outcome |
|---|---|---|---|---|---|---|
| 4 | 1000 | 64 ms | 32 ms | 35% | 31% | passes |
| 8 | 1000 | 72 ms | 46 ms | 52% | 41% | passes |
| 12 | 1000 | 76 ms | 54 ms | 61% | 46% | passes |
| 16 | 1000 | 91 ms | 69 ms | 73% | 54% | passes |
| 16 | 15 | 87 ms | 65 ms | 71% | 58% | passes |
| 20 | 1000 | 120 ms | 114 ms | 82% | 67% | passes |
| 24 | 1000 | 196 ms | 181 ms | 90% | 70% | fails, no socket lost |

From 16 rooms on the generator's own delay (`client_lag`) is 10 to 18 ms at p95, so a part of the latency in the last three rows is the generator's. A bigger generator was not available.

What the server reported, one process on 1 vCPU:

| | 1 room, 15 | 1 room, 1000 | 2 rooms, 1000 | 4 rooms, 1000 | 8 rooms, 1000 |
|---|---|---|---|---|---|
| Host CPU busy | 35% (54%) | 35% (63%) | 52% (97%) | 68% | 94% |
| API process, share of the core | 12% (33%) | 13% (46%) | 24% (76%) | 36% | 55% |
| Web container (nginx), share of the host | 6% | 6% | 11% | 16% | 24% |
| Event loop lag p95 | 5 ms (13) | 7 ms (159) | 14 ms (379) | 26 ms | 200 ms |
| Messages out, a second | 650 (3951) | 643 (3968) | 1285 (7817) | 2529 | 4302 |
| Out, Mbit/s | 5.0 (5.4) | 5.0 (5.3) | 10.0 (10.5) | 19.4 | 31.6 |
| Check of a board, average | 1 ms (6) | 10 ms (150) | 11 ms (163) | 11 ms | 12 ms |
| Save of a board, average | 5 ms | 23 ms (87) | 38 ms | 42 ms | 187 ms |
| Wait for the database, average | 0 ms | 0 ms | 0 ms | 0 ms | 1 ms |

The baseline's number is in brackets where it has one.

## A. Many small rooms

`visitors.py`: every visitor on a board of their own with 15 elements, half of them working. One process, 1 vCPU, the steps in a row on one database as in the baseline:

| Open boards | Reply to the visitor's own pointer p95, baseline | Now | A board opens, p95 | Outcome |
|---|---|---|---|---|
| 200 | 12 ms | 23 ms | 0.6 s | passes |
| 500 | 78 ms | 306 ms | 0.9 s | fails |
| 700 | 693 ms | 549 ms | 2.2 s | fails |
| 1000 | 855 ms, 83 timeouts | 2.3 s, 31 timeouts | 3.6 s | fails |
| 1500, 15% working | 164 ms | 594 ms | 22 s | fails |

This table does not show a regression, and it does not show a gain one can rely on. The row of 500 was run again on an empty database with four versions of the code, on the same VM on the same day:

| Code | Reply p95 in each run |
|---|---|
| Before P1, the code of the baseline | 1117 ms |
| After P3 | 36, 190, 136 ms |
| After P4 | 291 ms |
| Final, Prometheus scraping every 5 s | 201, 280, 497, 360 ms |
| Final, nothing scraping | 172, 234 ms |

So the baseline's 78 ms does not come back on its own code: that row sits at the knee of a shared vCPU, where one run differs from the next by several times (the VM lost between 1 and 14% of its core to other tenants from run to run). Read the row of 500 as "at the limit" in the baseline and now. Two things are visible through the noise: every version after P1 is several times faster than the code before it, and a scrape of `/metrics` every 5 seconds costs this scenario something, since the runs without it are all at the low end.

Four processes, 4 vCPU: 1000 visitors on an empty database all got in with no errors, a reply in 29 ms at p95 and a board open in 0.7 s, with the host half idle. On a database that already holds the people and boards of earlier steps the wait for the database grows from under a millisecond in rooms to tens and hundreds of milliseconds, while the CPU stays free. So for many single visitors the next limit is the database and how the server uses it, not the cores. A profile of every thread at 500 visitors shows threads queueing for the one database connection of the process, most of them behind the save of a board. Which query grows with the data is not found yet.

Memory: 470 MiB of the API on one process and 990 MiB over four at the biggest steps.

## C. Where the core goes

py-spy on the API process of the 1 vCPU target, 25 seconds at 50 samples a second, shares of the samples; the baseline in brackets:

| | 2 rooms, 15 elements | 1 room, 1000 elements | 4 rooms, 1000 elements |
|---|---|---|---|
| Sending frames to sockets | 29% (70%) | 8% (40%) | 34% |
| Check of a board after edits | under 1% (6%) | 2% (24%) | 7% |
| Counting the messages for `/metrics` | 3% (3%) | 1% (1%) | 2% |
| Idle | 62% (9%) | 88% (29%) | 44% |

At 4 rooms the process is idle for 44% of the samples while the host is 72% busy: the core is shared with nginx and the kernel's network path, and that, not the Python code, is what runs out first. Of what the process does, more than half is still one call per frame and recipient.

## What each slice was worth

| Slice | Expected | Measured |
|---|---|---|
| P1 `perf-ws-compression` | 8 to 15% of the API's core back; more bytes on the wire | Not separable from P2 in this run. Bytes did not grow: 5.0 Mbit/s a room against 5.3, since P2 sends six times fewer frames |
| P2 `perf-presence-batch` | At most 600 messages out a second for a room, a pointer within 150 ms | 643 to 650 a second, of them 600 presence; pointer 58 ms at p95 in one room. Sending fell from 70% of the samples to 29% |
| P3 `perf-incremental-check` | A check under 10 ms; "1 room, 1000" passes on edits | 10 to 12 ms on average, 14 to 18 ms when the host is full: at the mark, not under it. The row passes with an edit at 25 ms |
| P4 `perf-metrics-under-load` | Prometheus gets every scrape at a step that fails | It did, at every failing step of tables A and B. The scrape itself seems to cost the many-rooms scenario; see table A |
| P5 `perf-workers` | On 4 cores at least three times the rooms of one process | 20 rooms against 5: four times. The wait for the database between processes stayed under 3 ms in rooms |

## What is left to 100 rooms

One host with 4 cores holds 20 rooms, 600 people. The aim is 100 rooms, 3000 people.

1. **More cores.** The gain from 1 to 4 was linear. Nothing above 4 was measured, and the generator would have to grow with it.
2. **The proxy.** The web container takes 16 to 20% of the host at the heaviest passing step and 24 to 29% past it. P7 applies. The cheapest thing to measure first is the path between nginx and the API (a Unix socket or the host's network instead of the bridge), then a socket straight to the API.
3. **Frames.** One call per frame and recipient is over half of what the API process does. Edits are still relayed one by one; putting them into the 50 ms frame of presence is what tldraw does for both.
4. **The save.** It writes the whole board and goes from 23 ms to 190 ms as the host fills. The spec left it for this measurement to ask, and it asks.
5. **The database with many people.** The one connection per process and a write lock at the start of every transaction, reads included. This is what many single visitors meet first, before the CPU.

## Not measured

- Everything in section E of the baseline still stands, except "more than one CPU core".
- More than 4 cores, and 2 cores.
- Each slice on its own: by the owner's decision there was one measurement at the end, so P1 is not separated from P2.
- Table A is single runs on a shared vCPU, apart from the row of 500. Its numbers are good to a factor of two.
- A flaw of `rooms.py` found and fixed during this run: a person dragging an element that its maker deleted meanwhile dropped out of the step, 1 to 7 sockets of 120 to 480 on small boards. The rows of small boards above were run again with the fix.
