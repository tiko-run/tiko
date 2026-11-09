# API: board transfer

Both routes need a signed-in person; guests of a public link get none. Errors use the common body `{error: {code, message}}`.

| Route | Body | Answer | Errors |
|---|---|---|---|
| `GET /boards/{id}/export` | – | 200 `application/vnd.tiko.board+zip`, `Content-Disposition: attachment` named after the board | 404 without access |
| `POST /boards/import` | the `.tiko` file itself, up to 300 MB | 201 `{board: BoardSummary, moved: {kind: count}, notes: [{kind, text}]}` | 413 `file_too_large`, 422 `validation_failed` for a file that is not a board or is damaged, 422 `newer_file` from a newer format, 409 `board_limit`, 507 `file_quota`, 429 `too_many_attempts` while other imports run |

`moved` kinds: `cards`, `stickies`, `shapes`, `texts`, `frames`, `pictures`, `modules`, `reminders`, `arrows`; zero counts are left out.

`notes` kinds: `picture` (pictures that did not move, by reason), `planning_off`, `planning_added`, `planning_full`. Cards of a tracker not connected here are not a note: the board reads their state live.

A task's `state` gains `not_connected`: this instance does not read the task's tracker. A `not_connected` or `no_token` task carries the last snapshot the person's cache holds, when there is one.

The file layout is described in the guide, `moving-boards`. `manifest.json` `format` is `1`; a reader refuses a higher one with `newer_file`.
