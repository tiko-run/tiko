# Tasks: Gantt bars follow tracker dates

## Slice 1: task-dates

- [x] T001 `Task` gains `start`, `due` and the field each came from; API answer and the frontend zod schema; older clients ignore them
- [x] T002 Jira DC and Cloud: `duedate` added to the fetched fields; the site's `Start date` / `Target start` date fields found by name once per site and cached; first filled field wins per task; tests with a field filled in one project and another field in the other
- [x] T003 Settings → Jira: Start date field, Auto or one of the site's date fields; stored with the instance settings; a field gone from the site falls back to Auto
- [x] T004 GitHub: `due` from the issue's milestone due date
- [x] T005 Demo tasks: both dates, due only, none
- [x] T006 Card details show the dates; guide, CHANGELOG

## Slice 2: gantt-follow

- [x] T007 Row field for following the tracker, set on rows added from a task; old rows keep their dates; backend validation in `modules/gantt.py`
- [x] T008 Following bar drawn from the task's dates by Decision 5; the guessed end faded and dashed, named in the tooltip (Planning on draws stages, so the guess shows only with Planning off)
- [x] T009 Dragging or resizing a following bar keeps the dragged dates as the row's own; toast with Undo
- [x] T010 Dashed frame of the tracker's dates on rows with their own dates, clickable around the bar with Planning on and off; the tracker's dates in the bar's tooltip; Follow tracker dates; the row's switch
- [x] T011 A refresh with new dates moves following bars for everyone and saves the board; parent rows keep spanning children; a row cut into stages stops following
- [x] T013 Fit stages to tracker dates in the frame of a row with stages: equal shares, side by side, people kept
- [x] T012 Guide (Gantt page), CHANGELOG; media wait for the release
