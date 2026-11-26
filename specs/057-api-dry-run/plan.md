# Plan: Try a change before making it

- `backend/app/domain/batch.py`: `Batch.dry`, `Applied.planned`; arrows that go with a removed element are listed in `removed`.
- `backend/app/adapters/live/rooms.py`: both paths return right after `plan()` on a dry run, with the planned board as JSON; a dry restore is refused. The batch and the answer cross processes as they are.
- `backend/app/api/v1/elements.py`: `dry_run` on the four write bodies and the Gantt steps; `_applied` writes no `api_elements` rows on a dry run; `_answer` builds a dry answer from the planned board, its new elements editable; `overwrote` and `dry_run` on every write answer; a dry remove answers `200` with `Removed`.
- `backend/app/api/mcp.py`: `dry_run` on `update_elements`, `remove_elements`, `arrange`, `change_gantt`; `remove_elements` answers an object.
