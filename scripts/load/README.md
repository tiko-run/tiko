# Load tests

What the numbers in [baseline.md](../../specs/019-performance/baseline.md) and [results.md](../../specs/019-performance/results.md) of `specs/019-performance` were measured with. Run them against a throwaway instance with an empty database, never against one with real boards.

| Script | Scenario |
|---|---|
| `visitors.py` | Demo visitors, each on a board of their own: start a demo, open the board, hold the socket, drag cards. Many small rooms |
| `rooms.py` | Rooms of 30 on shared boards of 1000 elements: 5 drag, 2 create and delete, 10 move the pointer, 13 watch |
| `repeat.py` | A step run several times, or against several builds in turn: the median and the spread of every number |
| `window.py` | What the server saw in one measured window, read from Prometheus |
| `profile.py` | Top frames of a py-spy profile |

The scripts use `httpx`, `websockets` and `pycrdt`, which the backend already has:

```bash
cd backend
uv run python ../scripts/load/rooms.py setup --base http://target:3000 --password <admin password> --boards 40 --nodes 1000
uv run python ../scripts/load/rooms.py run --base http://target:3000 --password <admin password> --rooms 2 --hold 120
uv run python ../scripts/load/visitors.py --base http://target:3000 --users 500 --hold 40
```

Away from the repository: `uv run --with httpx --with websockets --with pycrdt python rooms.py ...`.

## The reference setup

- **Target**: a Linux VM with 1 vCPU and 2 GiB, tiko from `docker compose up` with `TIKO_PASSWORD` and `TIKO_METRICS_TOKEN` set in `.env`, and `prom/node-exporter` next to it. For `visitors.py` also `TIKO_DEMO=1` and a `TIKO_DEMO_LIMIT` above the sum of `--users` of every run on that database: without the first every visitor gets 404, the default limit of 500 stops the bigger rows of table A, and a visitor who dragged a card keeps their place for a week, so earlier runs count. Or start each run from an empty database.
- **Generator**: a second VM with 4 vCPU on the same private network, so the path between them adds nothing. It runs the scripts and a Prometheus that scrapes the target every 5 seconds: the API at `:8000/metrics` with the token and node exporter at `:9100`.
- `visitors.py` sets `X-Forwarded-For` to give every visitor an address of their own. nginx believes it only from a private network, which is where the generator sits.
- A step holds for 2 to 3 minutes: saves run every 2 to 10 seconds and the session check once a minute, so that covers every periodic job. Leave 40 seconds between steps.
- `rooms.py` puts a board back to its size when a step ends: the people who create delete what they made, and the run then sweeps the boards for what a closed or failed socket left behind. `rooms.py sweep` does the same by hand after a step that was interrupted. The saved history of the board still grows with every step, so make the boards anew (`rooms.py setup`, on an empty database) before a series that will be compared with another.
- `rooms.py run` prints `window <start> <end>`; give the two numbers to `window.py` on the Prometheus host for the server's side of the same step. It sums over the API processes; with `TIKO_WORKERS` above 1 give Prometheus every metrics port as a target. `PROM=http://host:port` names a Prometheus other than the local one.
- Run through the web container (port 3000), not the API's port: with several processes only the proxy knows which one holds a board.
- Node exporter does not tell nginx from the API. For the share of each, read `usage_usec` in `cpu.stat` of the container's cgroup at both ends of the window.
- Profile at about 70% of the knee, on the target: `py-spy record -p <pid> -d 25 -r 50 -f raw -o prof.txt`, then `profile.py prof.txt`. `pgrep -f 'uvicorn --factory'` lists the API processes. With `TIKO_WORKERS` above 1 a board lives in one of them, so profile each, or the one `top` shows busiest: another may be idle.

Watch `client_lag` in the output: when its p99 goes over a few milliseconds, the generator is the bottleneck and the latencies are its own.

## Repeats and two builds

One run of a step near the limit says little: on a shared vCPU the same row came out several times apart. `repeat.py` runs the step three times and prints the median with the least and the most:

```bash
uv run python ../scripts/load/repeat.py --window --containers tiko-api-1 tiko-web-1 --docker "ssh target docker" -- \
  uv run python ../scripts/load/rooms.py run --base http://target:3000 --password <admin password> --rooms 4 --hold 120
```

- `--containers` reads the CPU each container used inside the measured window from its cgroup, as a share of one core. `--docker` says how to reach Docker on the target.
- `--window` adds the server's side from `window.py`, with the five kinds of database work that held the database longest.
- `--variant name='command'`, given twice or more, compares builds: before every run the command puts that build in place and returns when it answers, and the builds take turns, so whatever drifts over the hour drifts for all of them. With the release images: `--variant old='ssh target "cd tiko && TAG=2026.10.11 docker compose up -d --wait"'`.
- `{run}` in the step becomes 0, 1, 2 and so on. `visitors.py` needs it: a visitor's address may start only a few demos, so every run takes new ones with `--offset {run}000`.

Compare two builds only from one such series. A number from another day is another machine.

## Passing

A step passes when a pointer and an edit reach the others in a room within 150 ms at p95, a board opens within 2 s at p95 and there are no errors.

Do not read the SQLite file of a running instance from the host on Docker Desktop: closing that connection checkpoints the WAL across the VM boundary and the API answers "disk I/O error" until it is restarted.
