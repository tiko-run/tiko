# API: workspaces

Each slice fixes its part before its code. Shapes not named here do not change; they now answer for the workspace of the request.

## The workspace of a request

A board route, a live socket and a public link take the workspace of their board. Every other route uses the signed-in person's workspace, or a demo visitor's own. A board, invite or person of another workspace answers `404`, the same as one that does not exist.

## `GET /api/auth/status` (`feat/server-admin`)

`me` gains `server_admin` and `workspace`; `role` is the role in the workspace:

```json
{
  "signed_in": true,
  "me": {
    "id": "u1", "username": "mira", "name": "Mira Example",
    "role": "admin",
    "server_admin": true,
    "workspace": {"id": "w1", "name": "Default"}
  }
}
```

A person with no workspace gets `workspace: null` and `role: null`.

## Server admin (`feat/server-admin`)

These need `server_admin`, answer `403` otherwise, and work with or without a workspace:

- `POST /api/update`, `GET` and `PUT /api/privacy`, `/metrics` without a token. `GET /api/update` stays open to everyone signed in, so a running update shows its progress to all.
- `GET /api/accounts`: every account except demo visitors.

  ```json
  {"accounts": [{"id": "u2", "username": "dan", "name": "Dan Example", "server_admin": false,
    "disabled": false, "in_workspace": true, "last_sign_in_at": null, "created_at": "2026-10-20T10:00:00+00:00"}]}
  ```

- `PATCH /api/accounts/{id}` with `{"disabled": true|false}`. Disabling the last active server admin answers `409`.
- `POST /api/accounts/{id}/reset`: the password reset link, as `POST /api/people/{id}/reset` answered before. That route is removed.

The server admin is the first account of a server; this spec has no way to make another. `reset_password.py` stays the way back in when that account is lost.

The privacy switches, the instance id and the last ping time move to `server_settings`; the answers of these routes keep their shape.

## People (`feat/server-admin`)

`PATCH /api/people/{id}` takes `{"role": "admin"|"member"}` only; `disabled` moves to `/api/accounts/{id}`. `GET /api/people` keeps `disabled` for display.

## No workspace (`feat/workspace-membership`)

A signed-in person with no workspace (removed from it) can still use `/api/auth/*`, `PATCH /api/me` and `PUT /api/me/password` for their own profile and password, `GET /api/update` and `GET /api/version` to follow a running update, `/api/invites/{token}` with `/accept` and `/join`, public links, and `/api/accounts`, `/api/privacy` and `POST /api/update`, which answer `403 forbidden` unless they are the server admin. A live socket closes with `1008`. Every other route answers `403`:

```json
{"error": {"code": "no_workspace", "message": "You are not in a workspace. Ask an admin for an invite link."}}
```

## Workspace admin (`feat/workspace-membership`)

These need `role: "admin"` in the workspace and answer `403` otherwise:

- `PUT /api/settings` and `PATCH /api/planning` (Planning on or off), for the workspace's values. ENV values lock their fields, as today. The Planning lists (types, people, time off, fields, views, days off) stay writable by every member, as today: "New type" works from a stage.
- `GET /api/people`: the workspace's members and pending invites.
- `PATCH /api/people/{id}` with `{"role": "admin"|"member"}`.
- `DELETE /api/people/{id}`: removes the person from the workspace; the account and its sign-in stay. `204`; `422` for the admin's own id, `404` for a person outside the workspace. In the same transaction:
  - their board memberships go; boards they owned get the admin who removed them as owner, with the other members kept;
  - their tracker tokens and task caches in the workspace go;
  - their open live sockets close with `4403` (access changed), so their tabs read the account again.
- `POST /api/invites`, `DELETE /api/invites/{id}`.

The workspace keeps at least one active admin. Stepping down, being made a member, being removed or, through `PATCH /api/accounts/{id}`, being disabled as the last active admin answers `409`:

```json
{"error": {"code": "last_admin", "message": "The workspace needs another admin first."}}
```

## My tracker (`feat/workspace-membership`)

`/api/me/tracker` reads and writes the person's token in their workspace. The person directory (`GET /api/people/directory`) and "Everyone in this workspace" on a board list the workspace's members only.

## Invites (`feat/workspace-membership`)

`POST /api/invites` creates an invite to the workspace with a role. Opening it signed out creates an account as today and joins. `POST /api/invites/{token}/join` lets a signed-in person with no workspace join with their account (`204`); a password reset link answers `422`, a used one `410`; one already in a workspace gets `409`, and the link stays usable:

```json
{"error": {"code": "in_workspace", "message": "You are already in a workspace."}}
```

## `GET /api/planning` on a demo (`feat/demo-workspace`)

The answer drops `sample` (spec 031): a visitor's lists are their own and writable. Workload answers on the demo.

A visitor works in a workspace of their own and keeps it after `POST /api/auth/signup`. Their boards answer `404` to everyone outside it, an admin of the default workspace too, and the share picker of a visitor finds nobody else. `GET /api/people/directory` matches part of a name or username on a demo too, and no longer answers `429`.
