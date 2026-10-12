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
| `tiko_live_messages_total` | counter | Live messages by `direction` (`in`, `out`) and `kind` (`sync` for edits, `awareness` for cursors and selections, `other`) |
| `tiko_live_bytes_total` | counter | Bytes of those messages by `direction` |
| `tiko_live_closes_total` | counter | Sockets closed by the server, by `code` |
| `tiko_live_check_seconds` | histogram | Check of a board after a burst of edits |
| `tiko_live_save_seconds` | histogram | Save of an open board |
| `tiko_live_board_nodes` | histogram | Elements on a board when it is saved |
| `tiko_event_loop_lag_seconds` | histogram | How much later than asked the server wakes, sampled four times a second |
| `tiko_db_wait_seconds` | histogram | Wait of a request for the database |
| `tiko_db_transaction_seconds` | histogram | Length of a database transaction |
| `tiko_threadpool_busy` | gauge | Worker threads busy with a request |
| `tiko_demo_visitors`, `tiko_demo_limit` | gauge | Demo visitors kept and allowed; only with `TIKO_DEMO` |
| `process_*`, `python_*` | | CPU time, memory, open files and garbage collection of the API process |

The gauges are read at the moment of the scrape. Metrics of the host itself, like disk space and CPU steal, come from your own node exporter.
