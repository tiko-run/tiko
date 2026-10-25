# API: Home

Each slice fixes its part before its code. Shapes not named here do not change. Every route below works in the workspace of the request, as spec 032 set; a board the person cannot open answers `404`. A board in the trash also answers `404` on every ordinary board route; only the trash routes reach it: `GET /api/trash`, `POST /api/boards/{id}/restore` and `DELETE /api/boards/{id}?forever=1`.

## `GET /api/boards` (`feat/home`)

`BoardSummary` gains `created_at`; later slices add `preview`, `starred` and `folder_id`:

```json
{
  "boards": [
    {
      "id": "b1", "name": "Roadmap", "created_at": "2026-10-01T09:00:00Z",
      "updated_at": "2026-10-21T08:30:00Z", "my_role": "owner",
      "owner": {"id": "u1", "name": "Mira Example"}, "public": false,
      "preview": 42, "starred": true, "folder_id": "f1"
    }
  ],
  "all": []
}
```

- `preview` (`feat/board-previews`): the board version its preview follows, `null` for a board with nothing on it.
- `starred`, `folder_id` (`feat/stars-folders`): the person's own; `false` and `null` otherwise.

## `POST /api/boards/{id}/duplicate` (`feat/home`)

Anyone who can open the board. `201` with the new `BoardSummary`: owned by the person, named "Copy of …", with the same content, no members, no public link. `409 board_limit` at the limit, as `POST /api/boards`.

## `GET /api/boards/{id}/preview` (`feat/board-previews`)

Anyone who can open the board. `200 image/svg+xml`, `ETag: "<version>.<drawing>"`, where the drawing number grows when the server starts drawing previews differently; `304` on `If-None-Match` with the same tag. `404` for a board with nothing on it.

## Stars and folders (`feat/stars-folders`)

- `PUT /api/boards/{id}/star`, `DELETE /api/boards/{id}/star`: `204`.
- `GET /api/folders`: `{"folders": [{"id": "f1", "name": "Team", "position": 1}]}`, the person's own.
- `POST /api/folders` `{"name": "Team"}`: `201` with the folder. `422` for an empty or longer than 60 characters name, `409 folder_limit` past 100.
- `PATCH /api/folders/{id}` `{"name": "…"}` or `{"position": 2}`: `200`.
- `DELETE /api/folders/{id}`: `204`; its boards stay.
- `PUT /api/boards/{id}/folder` `{"folder_id": "f1"}` or `{"folder_id": null}`: `204`. A folder of someone else answers `404`.

## Trash (`feat/trash`)

- `DELETE /api/boards/{id}`: now moves the board to the trash; still `204`, still owner only. Sockets and public guests are closed as before.
- `DELETE /api/boards/{id}?forever=1`: owner, only a board in the trash; `204`, the board is gone with every row. A workspace admin who is not the owner gets `403`.
- `POST /api/boards/{id}/restore`: owner or workspace admin; `204`. Members, roles and the public link work again.
- `GET /api/trash`: the person's trashed boards; a workspace admin gets every trashed board of the workspace.

```json
{"boards": [{"id": "b1", "name": "Roadmap", "owner": {"id": "u1", "name": "Mira Example"},
  "deleted_at": "2026-10-21T08:30:00+00:00", "deleted_by": {"id": "u1", "name": "Mira Example"},
  "purge_at": "2026-11-20T08:30:00+00:00"}]}
```
