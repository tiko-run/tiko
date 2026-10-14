---
title: Configuration
description: Environment variables and reverse proxy settings for a self-hosted tiko.
---

Everything works without a `.env` file. To override defaults, copy [`.env.example`](https://github.com/tiko-run/tiko/blob/main/.env.example) to `.env` next to the compose file and edit it.

| Variable | Purpose | Default |
|---|---|---|
| `TIKO_PASSWORD` | Password of the first account, `admin`. When empty, one is generated on first start, printed once to the API log and saved to `data/password`. Not read once the account exists | generated |
| `TIKO_SECRET_KEY` | Encrypts tracker tokens at rest; needed only to connect a tracker (`openssl rand -base64 32`) | unset |
| `TIKO_TRACKER` | Tracker for everyone: `demo` or `jira`. Set, Settings → Task source shows it read-only | set in Settings |
| `JIRA_BASE_URL` | Jira URL for everyone, like `https://jira.example.com`; a wrong URL stops the start. Each person still adds their own token | set in Settings |
| `TIKO_DEMO` | `1` lets anyone start without an account as a demo visitor on the demo tasks, and sign up to stay. See [Running a demo](../demo/) | off |
| `TIKO_DEMO_LIMIT` | Demo visitors the instance keeps at once | `500` |
| `TIKO_BOARD_LIMIT` | Boards a person may own, admins and demo visitors aside | no limit |
| `TIKO_METRICS_TOKEN` | Lets a monitoring system read `/metrics` with `Authorization: Bearer <token>`. See [Monitoring](../monitoring/) | unset, admins only |
| `TIKO_METRICS_PORT` | A second port that serves `/metrics` to the token from its own thread, so it answers while the instance is overloaded. See [Monitoring](../monitoring/) | unset, no second port |
| `TIKO_SOCKET_DIR` | A directory shared by both containers; the web container reaches the API over Unix sockets in it. See [A Unix socket between the containers](#a-unix-socket-between-the-containers) | empty: the network |
| `TIKO_WORKERS` | API processes, one core each. Set it for both containers, as the compose files do. See [Several processes](#several-processes) | `1` |
| `GITHUB_TOKEN` | Read-only GitHub token that raises the request limit for public issues from 60 to 5000 an hour, so GitHub cards update at the board's pace. See [GitHub Issues](../github-issues/) | unset |
| `JIRA_TLS_VERIFY` | Verify Jira's TLS certificate; `false` skips the check | `true` |
| `JIRA_CA_BUNDLE` | Path inside the container to a CA bundle for a corporate certificate authority | unset |
| `LOG_LEVEL` | Log level | `info` |
| `DB_PATH` | SQLite file inside the container | `data/app.db` |
| `APP_ENV` | Environment name: `local`, `stage` or `production` | `local` |
| `UPDATE_CHECK` | Ask GitHub every 30 minutes for new releases to show "update available" in About, and how much the update matters; `false` turns it off | `true` |
| `TIKO_USAGE_STATS` | Daily usage counts without personal data, listed in [Usage stats](../privacy/). `false` turns them off and locks the switch in Settings → Privacy; unset, an admin decides there | unset (on) |
| `TIKO_STATS_URL` | Where the usage stats go, for your own collector; see [Usage stats](../privacy/#closed-networks-and-your-own-collector) | `https://t.tiko.run/v1/events` |
| `TIKO_ERROR_REPORTS` | Error reports, see [Error reports](../privacy/#error-reports). `true` turns them on, `false` off; either locks the switch in Settings → Privacy | unset (off) |
| `TIKO_ERROR_REPORTS_DSN` | Where error reports go: your own Sentry DSN instead of ours. `TIKO_ERROR_REPORTS=false` keeps the Sentry client from starting at all | the tiko project's Sentry (EU) |
| `TIKO_DEPLOY` | How tiko runs, reported in the usage stats; the installer sets `installer`, Railway and Render are found on their own | unset (`compose`) |
| `TIKO_PORT` | Port on your machine that Docker Compose gives the web UI | `3000` |
| `TIKO_API_PORT` | Port on your machine for the API when you run from source with `docker compose up`. The release compose file does not publish the API | `8000` |

To trust a corporate CA, put the bundle in `./data` (for example `data/corp-ca.pem`) and set `JIRA_CA_BUNDLE=data/corp-ca.pem`.

The refresh interval is set in Settings → Task source, not in the environment.

## Behind your own reverse proxy

Live boards use a WebSocket at `/api/boards/<id>/live`, on the same address as the rest of tiko. The proxy in front of tiko has to pass WebSocket upgrades to the web container (port 3000) and keep idle connections open. Without that, boards open view-only with "Live connection unavailable". Public links use `/api/public/<token>/live/<room>` the same way and fall back to checking for changes every few seconds.

### Several processes

One API process uses one core, so an instance with many busy boards stops at what one core can serve. `TIKO_WORKERS=4` starts four processes in the API container, on ports 8000 to 8003. A board is open in exactly one of them, the one its id names, and the web container sends everything about that board there. Requests that are about no board go to any of them.

```bash
# .env
TIKO_WORKERS=4
```

- Both containers need the number: the API to start the processes, the web container to pick one. The compose files pass it to both. On Render or Railway, set it on both services.
- Go through the web container (port 3000), as with one process. A socket that reaches the wrong process is closed and the tab tries again, so a proxy of your own that talks to port 8000 directly only works with one process.
- Signing out, role changes and the limits on wrong passwords and on public links work across the processes as they do in one.
- The processes stand and fall together: when one stops, the container restarts.

### A Unix socket between the containers

On one host the web container can reach the API over a Unix socket instead of the Docker network. In our measurement both containers used about a tenth less CPU on busy boards. It is off unless you turn it on, and it needs a directory that both containers see:

```yaml
# docker-compose.override.yml
services:
  api:
    environment:
      TIKO_SOCKET_DIR: /run/tiko
    volumes: ["sockets:/run/tiko"]
  web:
    environment:
      TIKO_SOCKET_DIR: /run/tiko
    volumes: ["sockets:/run/tiko"]
volumes:
  sockets:
```

The API keeps its ports as well, so health checks and metrics work as before. Platforms that run the two services apart, like Render and Railway, have no shared directory: leave it off there.


Caddy and Traefik pass WebSockets without extra settings:

```text
tiko.example.com {
    reverse_proxy localhost:3000
}
```

nginx needs the upgrade headers and a longer read timeout:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    server_name tiko.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 1h;
    }
}
```

Keep the `Host` header as the browser sent it: tiko refuses a live connection whose page address differs from the host it was asked for. Railway, Render and plain `docker compose` need no changes.
