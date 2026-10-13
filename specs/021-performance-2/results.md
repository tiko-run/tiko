# Results: performance of live boards, second round

**Measured:** 2026-10-13 on DigitalOcean `fra1`. **Builds:** end of spec 019 (`76a73ae`) and R6 (`da6ed8b`), alternated on the same target. Every row has three runs; cells show median `[least..most]`. The targets used shared CPUs. The account did not permit an 8-vCPU target, so the planned 8-core comparison could not be run.

Room steps use 30 sockets per room on 1000-element boards. Visitor steps use 15-element boards. A room step passes when presence and edit p95 are each at most 150 ms with no errors. Visitor steps use the same 150 ms reply, 2 s board-open, and no-error limits. A median below the limit with a spread across it is marked **borderline**.

## Table A: many small rooms

| vCPU | Visitors | Build | Socket sync p95 | Board open p95 | Demo p95 | Errors | Host busy | API, % of a core | DB wait avg |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 200 | 019 | 304 `[269..356]` ms | 392 `[313..429]` ms | 243 `[197..316]` ms | 0 | 42.9% | 22.4% | 0.2 ms |
| 1 | 200 | R6 | 303 `[239..354]` ms | 339 `[301..356]` ms | 244 `[221..264]` ms | 0 | 45.9% | 24.8% | 0.2 ms |
| 1 | 500 | 019 | 2196 `[945..2395]` ms | 2271 `[1234..3729]` ms | 1317 `[987..2049]` ms | 0 | 78.1% | 47.3% | 3.0 ms |
| 1 | 500 | R6 | 528 `[396..644]` ms | 682 `[613..843]` ms | 476 `[436..706]` ms | 0 | 73.2% | 47.2% | 0.8 ms |
| 4 | 1000 | 019 | 563 `[478..674]` ms | 542 `[392..579]` ms | 589 `[356..656]` ms | 0 | 56.7% | 150.6% | 31.5 ms |
| 4 | 1000 | R6 | 490 `[481..496]` ms | 369 `[362..377]` ms | 352 `[349..377]` ms | 0 | 55.8% | 149.1% | 16.7 ms |
| 4 | 2000 | 019 | 2867 `[2730..3344]` ms | 22718 `[13567..23580]` ms | 27793 `[26926..28497]` ms | 454 `[430..697]` | 73.3% | 205.0% | 295.4 ms |
| 4 | 2000 | R6 | 988 `[880..1074]` ms | 1078 `[826..1999]` ms | 1432 `[965..4051]` ms | 0 `[0..4]` | 80.1% | 232.2% | 772.4 ms |

The 1000-visitor R6 row still misses the 150 ms socket-sync target while the host is 56% busy; average database wait is 16.7 ms. At 2000 visitors, R6 improves the response and board-open results substantially, but socket sync remains over the limit and the spread includes up to four errors. The database wait grows sharply at that load.

## Table B: rooms of 30

Presence and edit cells show p95 in milliseconds. CPU cells show the median; API and web are percentages of one core. A web share of 60% on a 4-vCPU target is about 15% of the host.

| vCPU | Rooms | Presence p95, 019 | Presence p95, R6 | Edit p95, 019 | Edit p95, R6 | Host busy, R6 | API/core, R6 | Web/core, R6 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 4 | 63 `[57..68]` | 61 `[61..63]` | 38 `[20..58]` | 23 `[21..32]` | 51.2% | 26.6% | 9.6% |
| 1 | 5 | 76 `[68..91]` | 66 `[65..71]` | 63 `[45..76]` | 29 `[27..30]` | 58.0% | 32.5% | 11.4% |
| 1 | 6 | 89 `[86..105]` | 99 `[81..138]` | 79 `[71..85]` | 78 `[47..177]` | 70.8% | 40.3% | 15.0% |
| 1 | 7 | 190 `[179..247]` | 100 `[92..117]` | 203 `[143..231]` | 69 `[64..137]` | 72.3% | 42.8% | 15.0% |
| 1 | 8 | 193 `[158..197]` | 159 `[106..178]` | 175 `[174..189]` | 185 `[79..187]` | 79.4% | 48.1% | 16.8% |
| 2 | 6 | 58 `[56..61]` | 57 `[56..59]` | 24 `[21..27]` | 14 `[13..18]` | 37.5% | 38.5% | 17.1% |
| 2 | 8 | 58 `[56..58]` | 59 `[59..59]` | 24 `[19..39]` | 17 `[16..21]` | 45.3% | 48.9% | 21.6% |
| 2 | 10 | 57 `[56..65]` | 66 `[62..69]` | 24 `[22..43]` | 28 `[22..31]` | 52.9% | 59.9% | 26.2% |
| 2 | 12 | 75 `[68..75]` | 63 `[62..65]` | 54 `[50..60]` | 24 `[21..25]` | 57.5% | 66.5% | 28.5% |
| 2 | 14 | 77 `[77..105]` | 75 `[71..89]` | 62 `[51..89]` | 34 `[32..55]` | 66.2% | 79.0% | 34.1% |
| 2 | 16 | 98 `[98..148]` | 78 `[77..98]` | 72 `[66..119]` | 48 `[40..67]` | 73.0% | 87.6% | 38.1% |
| 2 | 18 | 163 `[155..176]` | 103 `[85..115]` | 126 `[113..148]` | 67 `[63..100]` | 79.3% | 98.4% | 41.5% |
| 4 | 16 | 74 `[73..94]` | 73 `[69..101]` | 64 `[46..88]` | 38 `[29..80]` | 54.4% | 129.3% | 56.6% |
| 4 | 20 | 74 `[70..143]` | 85 `[68..104]` | 49 `[44..687]` | 50 `[31..72]` | 64.1% | 157.6% | 66.1% |
| 4 | 24 | 106 `[99..135]` | 84 `[83..197]` | 116 `[91..396]` | 55 `[50..287]` | 67.4% | 172.4% | 69.0% |
| 4 | 28 | 180 `[151..186]` | 126 `[97..165]` | 168 `[136..350]` | 112 `[68..677]` | 76.4% | 199.8% | 78.5% |

At 1 vCPU, R6 raises the passing median from 6 to 7 rooms; 8 rooms still fail. At 2 vCPU, 18 rooms pass on R6 while the 019 build fails there. The 4-vCPU R6 build passes 24 rooms by median but the spread crosses 150 ms; 28 rooms also pass by median, with one or more runs beyond the limit. Treat 28 as a borderline result, not a reliable capacity.

### 24 rooms on 4 vCPU: proxy path variants

| Variant | Presence p95 | Edit p95 | Host busy | API/core | Web/core | Loop lag p95 |
|---|---:|---:|---:|---:|---:|---:|
| Bridge | 81.9 `[72.3..133.2]` ms | 47.8 `[33.1..117.6]` ms | 65.4% | 168.4% | 66.8% | 18.3 `[18.0..49.0]` ms |
| Unix socket | 75.8 `[72.4..87.3]` ms | 38.0 `[31.8..282.9]` ms | 61.6% | 156.9% | 60.4% | 18.3 `[15.9..24.8]` ms |
| Host network | 88.5 `[72.7..280.8]` ms | 51.6 `[33.1..663.5]` ms | 66.2% | 172.5% | 61.8% | 21.6 `[17.8..178.0]` ms |

The ranges overlap, and host CPU steal varies between runs. Neither Unix socket nor host networking shows a reliable improvement over the bridge. Web-container CPU is 15.1–16.7% of the 4-core host across these variants.

## Table C: API profile on 1 vCPU

`py-spy`, 25 seconds at 50 samples per second, R6 build, four rooms of 30 on 1000-element boards. 1,271 samples; no sampling errors.

| Profile entry | Samples | Reading |
|---|---:|---|
| `app/api/live.py:write` inclusive | 16.4% | WebSocket write path |
| `websockets_sansio_impl.send` self | 12.3% | Socket send implementation |
| `app/adapters/live/rooms.py:check` inclusive | 7.1% | Room check after edits |
| `app/adapters/storage/sqlite.py:save_live` inclusive | 0.9% | Board save |
| `asyncio.runners.run` self | 63.0% | Samples stopped at the event-loop runner; consistent with substantial idle time |

The socket-write path is well below the 50% trigger for a different WebSocket server. This profile was taken at the specified four-room Table C load, not at the capacity edge.

## R8 verdict

| Part | Trigger evidence | Result and next step |
|---|---|---|
| SQLite | At 1000 visitors on 4 vCPU, average DB wait is 16.7 ms while host busy is 55.8%; socket-sync p95 is 490 ms. At 2000 visitors the wait is 772 ms. | **Candidate limit for many visitors.** R1 improved the wait, but the 1000-visitor row still misses. Isolate DB wait in a focused follow-up before choosing a second storage adapter. |
| Uvicorn socket layer | `live.write` is 16.4% inclusive in the API profile, below the “over half” trigger. | **Not triggered.** Do not prototype a replacement server from this evidence. |
| Python room core | The spec considers this only if a socket-server prototype fails to move the limit; that prototype was not triggered. | **Not triggered / not tested.** |
| Proxy | The web container uses 15.1–16.7% of the host in the 24-room path comparison, above the 10% trigger. | **Triggered.** Bridge, Unix socket, and host networking are indistinguishable within spread. A direct browser-to-API socket is a possible next experiment, but adds TLS/port and install complexity; owner decision required. |
| Capacity / cores | 4 vCPU reaches 24 rooms by median and 28 only at the edge; 8 vCPU was unavailable. The aim is 100 rooms. | **Aim not met.** More cores or hosts may be required; scaling beyond 4 vCPU remains unmeasured. |

### Save path signal

The R6 build's average save reaches 93 ms at 7 rooms on 1 vCPU and 115 ms at 28 rooms on 4 vCPU. The four-room profile attributes 0.9% of samples to `save_live`, while room checks use 7.1%. These data do not isolate save cost at the capacity edge. Before building R5, profile the save path under a load that crosses the room limit and compare it with the event-loop and proxy work.

## Run files

Raw generator outputs and the profile are kept in the git-ignored `tmp/do/r7/` directory for this checkout. The six temporary droplets, their firewall, and their DigitalOcean SSH key were deleted after collection; the private key was removed locally.
