# Implementation Plan: Instance password

**Branch**: `007-instance-password` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-instance-password/spec.md`

## Summary

One password closes every instance: from ENV, or generated on first start and saved to `data/password`. A pure ASGI middleware checks a signed session cookie on every request except health checks and the auth routes; the frontend shows a sign-in screen when the API answers `auth_required`. The Railway template generates the password. Delivered in 1 slice.

## Technical Context

**Language/Version**: Python 3.12 + FastAPI, TypeScript + React 19

**Primary Dependencies**: existing only; signing with stdlib `hmac` and `hashlib`.

**Storage**: `data/password` when ENV has none. The session lives in the cookie; failed attempts are counted in memory.

**Testing**: pytest for the token (sign, verify, expiry, tamper, password change) and the middleware (open paths, 401, 429) and the generated password (created once, mode 0600, reused, logged once); vitest for the sign-in screen and the 401 redirect; curl over every route; screenshot of the sign-in screen in light and dark.

**Constraints**: gate always on; no change to existing routes' shapes, only a new 401 on all of them without a session.

## Constitution Check

| Principle | Status |
|---|---|
| I. Main always runs | Pass: one `feat/instance-password` branch |
| II. Works without keys | Pass: without ENV the password is generated and logged |
| III. Hypothesis-driven scope | Pass: launch plan step 2 (G1 2026-10-07), team mode step 0 (G1 2026-10-08) |
| IV. Vertical slices | Pass: UI, API and config in one slice |
| V. Contract-first | Pass: [contracts/api.md](contracts/api.md), announced as a new error on every route |
| VI. Production feel, minimal | Pass: no accounts, no tables |
| VII. Clean code | Pass |
| VIII. Verifiable tasks | Pass: tests and curl list |

## Design

```text
backend/app/config.py            tiko_password: SecretStr | None
backend/app/domain/access.py     Access: sign_in(password, now) -> token, is_valid(token, now); 5 failures a minute per instance
backend/app/api/auth.py          POST /api/auth/login, POST /api/auth/logout, GET /api/auth/status
backend/app/api/gate.py          ASGI middleware: open paths, cookie check, 401 auth_required
backend/app/adapters/password_file.py   read or create data/password, 0600
backend/app/main.py              resolve the password (ENV or file), add the middleware
frontend/src/api/auth.ts         status, login, logout (zod)
frontend/src/auth/SignIn.tsx     one password field, shadcn Card, Input, Button
frontend/src/App.tsx             on auth_required show SignIn; React Query retry off for it
frontend/src/settings/SettingsSheet.tsx   "Sign out"
frontend/nginx.conf.template     pass X-Forwarded-Proto to the API
```

Token: `base64(expires_at) + "." + hex(HMAC-SHA256(key, expires_at))`, key = `SHA-256("tiko-session" + secret key + password)`. Changing either value invalidates every session: all of the owner's browsers and anyone who used the old password. Verification is one HMAC and one compare, no I/O.

Cookie: `tiko_session`, `Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age` 30 days, `Secure` when `X-Forwarded-Proto` or the request scheme is `https`. `SameSite=Lax` plus JSON-only bodies covers CSRF for this single-user gate.

Login: a wrong password waits as long as a right one (constant-time compare of SHA-256 digests). The limiter counts failures for the whole instance; team mode moves to per-account limits.

Frontend: `GET /api/auth/status` on boot returns `{signed_in: bool}`; the app renders SignIn until signed in. Any later `auth_required` drops back to SignIn, for example after a password change.

Railway: template variable `TIKO_PASSWORD=${{secret(20)}}` on the API service; template README, project README, `.env.example` and the quick-start guide explain it.

## Risks

| Risk | Plan B |
|---|---|
| Railway or Render do not send `X-Forwarded-Proto`, so the cookie is not `Secure` | Set `Secure` whenever `APP_ENV` is not `local` |
| The in-memory limiter resets on restart or with several API replicas | Accepted for one user per instance; team mode moves it to the database |
| Guessing a password | A generated 20-character password makes guessing pointless |
