# Plan: Sign-in limits that follow the client

**Spec**: [spec.md](spec.md)

## Slices

| # | Branch | Story | What | Done when |
|---|---|---|---|---|
| 1 | `feat/client-address` | US2 | nginx reads the trusted proxies and the client header from ENV; guide section "The client's address" | a test of the generated config; on Railway a client keeps one address across requests |
| 2 | `feat/known-browser` | US1 | limits by address and username, the known-browser cookie | API tests of US1; `make smoke` |
| 3 | release and the demo | US2 | release; the demo's ENV; Cloudflare in front of the demo | six new demo visitors from one address: the sixth is refused |

## Slice 1: the client's address

- `frontend/real-ip.envsh` (runs before the template) writes `/etc/nginx/real-ip.conf` from `TIKO_TRUSTED_PROXIES` (comma-separated CIDRs, default the private networks of today) and `TIKO_CLIENT_IP_HEADER` (default `X-Forwarded-For`). Each CIDR and the header name are checked against a strict pattern; a bad value stops the container with a clear line, so nothing reaches the config unchecked. `real_ip_recursive on` stays.
- `nginx.conf.template` includes the file in place of the fixed lines.
- Both compose files pass the two variables to the web container.
- Test: `scripts/test-real-ip.sh` runs the envsh with sample values and compares the output, called from `make check`.
- Guide: "The client's address" in Configuration, with values for Railway, checked on the demo by the nginx access log, and for Cloudflare in front as Cloudflare documents them. Render does not document how its proxy treats a client's `X-Forwarded-For`, so it waits for a check.

## Slice 2: the known browser

- Table `known_browsers (token_hash PRIMARY KEY, user_id, created_at)`, migration `023`. A password change and disabling a person delete their rows.
- `Accounts.sign_in(username, password, address, browser, now)`: a known browser for that username skips the username and instance limits and counts its own failures (10 in 15 minutes, then it is treated as unknown); otherwise limits by address, by username and for the instance. A success returns the session and, when the browser was not known, a new browser token.
- `api/auth.py` reads and sets `tiko_device` next to the session cookie; the address comes from `X-Real-IP` as the demo's does.
- Tests in `backend/tests` for every scenario of US1.

## Risks

| Risk | Answer |
|---|---|
| A wrong `TIKO_TRUSTED_PROXIES` lets clients pick their address | The guide gives exact values per platform and says to trust everything only where the platform rewrites the header itself |
| The platform's own address of a service bypasses a proxy in front | The guide says to remove it; the demo's is removed in slice 3 |
