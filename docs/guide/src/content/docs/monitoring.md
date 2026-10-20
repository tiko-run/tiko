---
title: Monitoring
description: The Prometheus metrics of a tiko instance, who may read them and what to watch.
---

The API serves Prometheus metrics at `/metrics`, on its own port 8000 and outside `/api`, so the web container never shows them to the internet. An admin reads them when signed in. Nobody else does: a member or a demo visitor gets 404.

## Letting Prometheus in

Set a token and Prometheus reads the metrics without an account:

```bash
# .env
TIKO_METRICS_TOKEN=<openssl rand -hex 24>
```

The token opens `/metrics` and nothing else. Run Prometheus where it reaches the API: on the compose network the address is `api:8000`.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: tiko
    scrape_interval: 15s
    authorization:
      credentials: <the token>
    static_configs:
      - targets: ["api:8000"]
```

### A port that answers under overload

On port 8000 a scrape waits in the same line as every board and request. When the instance is overloaded, which is when you most want its numbers, the scrape can time out. Give the metrics a port of their own and they are served by a separate thread that does not wait for the rest:

```bash
# .env
TIKO_METRICS_TOKEN=<openssl rand -hex 24>
TIKO_METRICS_PORT=9464
```

Point Prometheus at `api:9464` instead of `api:8000`, with the same token. The port serves `/metrics` to the token and nothing else, and stays closed when no token is set. It holds 8 connections at once and drops one that sends no request within 5 seconds; keep it on the private network all the same, like port 8000. On this port the gauges of open boards and sockets are up to a quarter of a second old, longer when the server runs late. On a demo the count of visitors is the last known one when the database is slow to answer.

With `TIKO_WORKERS` above 1 every process counts its own boards, sockets and requests, and has a metrics port of its own: process 0 on `TIKO_METRICS_PORT`, process 1 on the next one, and so on. Give Prometheus all of them as targets (`api:9464`, `api:9465`, ...) and sum over `instance` for the whole of tiko; one process that is busier than the rest shows on its own line. `/metrics` on port 8000 and up answers for the process you ask.

`/health` answers as soon as the process is up. `/ready` also asks the database and answers 503 when it does not reply; point an uptime check at `/ready`.

## What to watch

The API is one process on one CPU core, and every open board is a socket in it. These tell how close an instance is to its ceiling:

| Metric | What it tells |
|---|---|
| `tiko_event_loop_lag_seconds` | How late the server gets to its work. Under a few milliseconds when healthy; tenths of a second mean the core is not enough and people see edits late |
| `tiko_live_sockets` | Open boards, by `kind`: `person` or `guest` of a public link |
| `process_open_fds` against `process_max_fds` | Open files of the API. Every socket is one; at the limit new connections are refused |
| `tiko_live_outbox_max` | Messages waiting for the slowest socket. A socket with 512 waiting is closed with code 1013 |
| `tiko_live_closes_total` | Sockets the server closed, by `code`. 1013 is a client too slow to keep up, 4429 a full board |
| `tiko_demo_visitors` against `tiko_demo_limit` | How full a demo is. At the limit "Try the demo" refuses newcomers |

## All metrics

| Metric | Type | Meaning |
|---|---|---|
| `http_requests_total` | counter | Requests by `method`, `route` and `status` |
| `http_request_duration_seconds` | histogram | Time to answer, by `method` and `route` |
| `tiko_live_rooms` | gauge | Boards held open in memory |
| `tiko_live_sockets` | gauge | Open live sockets by `kind` |
| `tiko_live_outbox_max` | gauge | Messages waiting in the fullest queue of a socket |
| `tiko_live_messages_total` | counter | Live messages received and sent by `direction` (`in`, `out`) and `kind` (`sync` for edits, `awareness` for cursors and selections, `other`) |
| `tiko_live_bytes_total` | counter | Bytes of those messages by `direction` |
| `tiko_live_closes_total` | counter | Sockets closed by the server, by `code` |
| `tiko_live_check_seconds` | histogram | Check of a board after a burst of edits |
| `tiko_live_save_seconds` | histogram | Save of an open board |
| `tiko_live_board_nodes` | histogram | Elements on a board when it is saved |
| `tiko_event_loop_lag_seconds` | histogram | How much later than asked the server wakes, sampled four times a second |
| `tiko_db_wait_seconds` | histogram | Wait of a request for the database |
| `tiko_db_transaction_seconds` | histogram | Length of a database transaction |
| `tiko_db_held_seconds` | summary | The same time as a sum and a count by `kind`: the storage method that asked, like `PgBoardRepo.listing` |
| `tiko_threadpool_busy` | gauge | Worker threads busy with a request |
| `tiko_demo_visitors`, `tiko_demo_limit` | gauge | Demo visitors kept and allowed; only with `TIKO_DEMO` |
| `process_*`, `python_*` | | CPU time, memory, open files and garbage collection of the API process |

On port 8000 the gauges are read at the moment of the scrape. Metrics of the host itself, like disk space and CPU steal, come from your own node exporter.
