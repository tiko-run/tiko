# Feature Specification: Live metrics

**Feature Branch**: `018-live-metrics`

**Created**: 2026-10-13

**Status**: Owner told the agent on 2026-10-13 to build the metrics into the product after a short spec, without waiting for G2; shown at G3.

**Input**: A load test of a demo instance on a 1 vCPU host. Two of the three ceilings it met were invisible from outside: a connection limit in nginx and the file limit of the API container. `/metrics` held HTTP counters only and said nothing about open boards.

## Why

An instance is one API process on one core, and every open board is a socket in it. The operator of a busy instance has to see how close it is to its ceiling before people see "502". The same numbers are what a load test reads to find where the time goes.

## Decisions

1. **New metrics carry the prefix `tiko_`.** The two HTTP metrics keep their names: dashboards may already use them.
2. **What is measured**: open rooms and sockets, live messages and bytes by direction and kind, sockets closed by the server by code, the fullest queue of a socket, the time to check and to save a board, the size of a saved board, the lag of the event loop, the wait for the database connection and the length of a transaction, busy worker threads, demo visitors against the limit. Process metrics (CPU, memory, open files) come from the client library as before.
3. **Gauges are read at the scrape**, on the event loop where the rooms live. Nothing is kept up to date between scrapes, so they cost nothing on the path of a message.
4. **Counting a message is two counter increments** with the label looked up in advance. No per-board and no per-person label: cardinality stays fixed.
5. **`/metrics` is for admins and for monitoring.** A member or a demo visitor gets 404; before, any signed-in person could read it. `TIKO_METRICS_TOKEN` lets a scraper in with `Authorization: Bearer <token>`; the token opens that one route. Without a session and without the token the answer stays 401.
6. **Out of scope**: metrics of tracker calls (Jira, GitHub), a bundled Prometheus or dashboard, metrics of the web container.

## User Story 1 - The operator sees how busy the instance is (P1)

As the person who runs a tiko instance, I point Prometheus at it and see open boards, how late the server runs and how full the demo is.

**Independent Test**: start the stack with `TIKO_METRICS_TOKEN`, open a board in a browser, `curl -H "Authorization: Bearer <token>" :8000/metrics`: `tiko_live_sockets{kind="person"}` is 1 and `tiko_live_messages_total` grows while the pointer moves over the board.

**Acceptance**:

1. With a board open, `tiko_live_rooms` and `tiko_live_sockets` count it; after the tab closes and the room is dropped they go back.
2. A scraper with the token reads `/metrics` without a session; a wrong token, or a token when none is set, gets 401; the token opens no other route.
3. A member and a demo visitor get 404 on `/metrics`.
4. On a demo instance `tiko_demo_visitors` and `tiko_demo_limit` are there.
5. The guide lists every metric and says what to watch.
