# API: workspaces

Draft for G2. Each slice fixes its part before its code. Shapes not named here do not change; they now answer for the workspace of the request.

## The workspace of a request

A board route, a live socket and a public link take the workspace of their board. Every other route uses the signed-in person's workspace, or a demo visitor's own. A board, invite or person of another workspace answers `404`, the same as one that does not exist.

## `GET /api/auth/status`

`me` gains `serverAdmin` and `workspace`; `role` becomes the role in the workspace:

```json
{
  "signed_in": true,
  "me": {
    "id": "u1", "username": "mira", "name": "Mira Example",
    "role": "admin",
    "serverAdmin": true,
    "workspace": {"id": "w1", "name": "Default"}
  }
}
```

A person with no workspace gets `workspace: null` and `role: null`.

## Server settings and accounts

`/api/version/update`, `PUT /api/privacy`, `/metrics` without a token, `POST /api/people/{id}/reset` and disabling an account in `PATCH /api/people/{id}` need `serverAdmin`. `403` otherwise.

`GET /api/people` answers the workspace's members with their role for a workspace admin. The server admin also gets `GET /api/accounts`: every account with `disabled` and whether it is in a workspace.

## Settings and Planning

`GET` and `PUT /api/settings` and everything under `/api/planning` need the workspace admin for writes, as they need the instance admin today. Values are per workspace. ENV values lock their fields, as today.

## My tracker

`/api/me/tracker` reads and writes the person's token in their workspace.

## `GET /api/planning` on a demo

From `feat/demo-workspace` the answer drops `sample` (spec 031): a visitor's lists are their own and writable. Workload answers on the demo.

## Invites

`POST /api/invites` creates an invite to the workspace with a role. Opening it signed out creates an account as today and joins. Opening it signed in, while already in a workspace, answers `409` with a message.
