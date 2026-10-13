# Baseline: what one instance holds

Measured on 2026-10-13 with the scripts in [scripts/load](../../scripts/load/README.md), on the reference setup described there: tiko from `docker compose up` on a Linux VM with 1 vCPU and 2 GiB, the load generator on a second VM in the same private network. Every step was held for 40 to 180 seconds; nothing here says how an instance behaves over hours.

A step passes when a pointer and an edit reach the others in a room within 150 ms at p95, a board opens within 2 s at p95 and there are no errors.

## A. Many small rooms

`visitors.py`: every visitor on a board of their own with 15 elements. Code: v2026.10.15 with #134 and, for the last row, the file limit of #137. In this script a moving pointer sends 3 frames a second and a drag 12; a real tab sends up to 20. The numbers are therefore kinder than a real crowd.

| Open boards | Share that works | Reply to the visitor's own pointer, p95 | Outcome |
|---|---|---|---|
| 200 | half | 12 ms | passes; API at a third of the core |
| 500 | half | 78 ms | passes |
| 700 | half | 693 ms | no errors, the core is full, too slow |
| 1000 | half | 855 ms | 83 timeouts, 859 got in |
| 1500 | 15% | 164 ms | no errors; a board opens in 1.4 to 1.9 s at p95 while people arrive at 10 a second |

Memory was never close: 390 MiB of the API at 1500 open boards. The database held 34 MiB.

## B. Rooms of 30

`rooms.py`: 30 sockets on one board: 5 drag, 2 create and delete, 10 move the pointer, 13 watch. Pointers at 20 frames a second while moving. Code: the branch of #138.

| Rooms | Elements on the board | Pointer p95 | Edit p95 | Outcome |
|---|---|---|---|---|
| 1 | 15 | 18 ms | 17 ms | passes |
| 1 | 1000 | 156 ms | 263 ms | at the edge; the edit is over |
| 2 | 1000 | 515 ms | 513 ms | fails |
| 4 | 1000 | 6.3 s | 6.5 s | collapse: 30 sockets lost, 8 of them closed as too slow (1013) |
| 4 | 15 | 7.9 s | 7.7 s | collapse: 127 sockets closed as too slow (1013) |
| 8 | 15 | 6.1 s | 6.1 s | collapse: 68 could not get in |

What the server reported for the same windows:

| | 1 room, 15 | 1 room, 1000 | 2 rooms, 1000 |
|---|---|---|---|
| Host CPU busy | 54% | 63% | 97% |
| API, share of the core | 33% | 46% | 76% |
| Event loop lag p95 | 13 ms | 159 ms | 379 ms |
| Messages in, a second | 132 | 132 | 261 |
| Messages out, a second | 3951 | 3968 | 7817 |
| Out, Mbit/s | 5.4 | 5.3 | 10.5 |
| Check of a board, average | 6 ms | 150 ms | 163 ms |
| Checks, share of the core | 1% | 20% | 40% |
| Save of a board, average | not read | 87 ms | not read |

One room turns 132 messages a second into almost 4000: every pointer frame goes to the 29 others and back to its sender.

At 2 rooms on small boards the API process took 74% of the host's CPU and nginx 25%: it proxies every frame of every socket on the same core.

At 4 rooms on big boards Prometheus could not read `/metrics` at all: the scrape timed out. The route was served on the event loop then; since #138 the rendering runs in a worker thread, and this has not been measured again.

## C. Where the core goes

py-spy on the API process, 25 seconds at 50 samples a second, shares of the samples:

| | 2 rooms, 15 elements | 1 room, 1000 elements |
|---|---|---|
| Sending frames to sockets, all of it | 70% | 40% |
| of which compressing each frame (permessage-deflate) | 15% | 8% |
| Check of a board after edits | 6% | 24% |
| of which reading the whole board out of the CRDT | 3% | 12% |
| Counting the messages for `/metrics` | about 3% | about 1% |
| Idle | 9% | 29% |

Sending is one call down to the socket for every frame and every recipient. The check reads and validates every element of the board after each burst of edits, on the event loop, so nothing else is served for its 150 ms.

## D. Ceilings met on the way

| Ceiling | Where | Status |
|---|---|---|
| About 510 open boards | nginx: 1024 connections a worker, two for a socket | fixed in #134 |
| About 1000 open boards on a Linux host | the API container's limit of 1024 open files | fixed in #137 |
| 500 demo visitors | a constant | `TIKO_DEMO_LIMIT` since #137 |
| Containers stayed down after a crash | no restart policy in `docker-compose.yml` | fixed in #137 |
| 30 connections on a board | `MAX_CONNECTIONS` in `domain/live.py` | by design |
| 2000 elements on a board | `MAX_NODES` in `domain/boards.py` | by design |

## E. Not measured

- Anything longer than three minutes: leaks, the growth of the database.
- The browser: how the web app draws a board of 1000 elements while 30 people move.
- The path over the internet. The generator sat in the same private network.
- A real tracker. Only the demo tasks took part.
- More than one CPU core, and a core that is not shared with other tenants.
- The same room with distinct people: every socket signed in as the same admin.

Two flaws of `rooms.py` as it was for table B, both fixed since. The boards were used again from step to step and each step left up to 30 elements on a board, so the later rows ran on boards up to 3% bigger, with a longer history. And a person who creates elements reused one id after their fifteenth, so late in a step they rewrote an element instead of adding one; the number of edits a second was the same.

A run on a laptop (Docker Desktop, the API held to one CPU) gave about three times the numbers of table A. It is not comparable with the VM and is not a baseline.
