# Load tests

What the numbers in [specs/019-performance/baseline.md](../../specs/019-performance/baseline.md) were measured with. Run them against a throwaway instance with an empty database, never against one with real boards.

| Script | Scenario |
|---|---|
| `visitors.py` | Demo visitors, each on a board of their own: start a demo, open the board, hold the socket, drag cards. Many small rooms |
| `rooms.py` | Rooms of 30 on shared boards of 1000 elements: 5 drag, 2 create and delete, 10 move the pointer, 13 watch |
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

- **Target**: a Linux VM with 1 vCPU and 2 GiB, tiko from `docker compose up` with `TIKO_PASSWORD` and `TIKO_METRICS_TOKEN` set in `.env`, and `prom/node-exporter` next to it. For `visitors.py` also `TIKO_DEMO=1` and a `TIKO_DEMO_LIMIT` above the largest `--users` of the run: without the first every visitor gets 404, and the default limit of 500 stops the bigger rows of table A.
- **Generator**: a second VM with 4 vCPU on the same private network, so the path between them adds nothing. It runs the scripts and a Prometheus that scrapes the target every 5 seconds: the API at `:8000/metrics` with the token and node exporter at `:9100`.
- `visitors.py` sets `X-Forwarded-For` to give every visitor an address of their own. nginx believes it only from a private network, which is where the generator sits.
- A step holds for 2 to 3 minutes: saves run every 2 to 10 seconds and the session check once a minute, so that covers every periodic job. Leave 40 seconds between steps.
- `rooms.py` puts a board back to its size when a step ends: the people who create delete what they made. The saved history of the board still grows with every step, so make the boards anew (`rooms.py setup`, on an empty database) before a series that will be compared with another.
- `rooms.py run` prints `window <start> <end>`; give the two numbers to `window.py` on the Prometheus host for the server's side of the same step.
- Profile at about 70% of the knee, on the target: `py-spy record -p $(pgrep -x uvicorn) -d 25 -r 50 -f raw -o prof.txt`, then `profile.py prof.txt`.

Watch `client_lag` in the output: when its p99 goes over a few milliseconds, the generator is the bottleneck and the latencies are its own.

## Passing

A step passes when a pointer and an edit reach the others in a room within 150 ms at p95, a board opens within 2 s at p95 and there are no errors.

Do not read the SQLite file of a running instance from the host on Docker Desktop: closing that connection checkpoints the WAL across the VM boundary and the API answers "disk I/O error" until it is restarted.
