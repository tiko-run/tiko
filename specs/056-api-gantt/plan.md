# Plan: An agent keeps a Gantt plan

- `backend/app/domain/gantt_steps.py`: the steps and their engine, pure; the web app's clean-up after every step; the module's validation names the step.
- `backend/app/domain/batch.py`: `NewGantt`, `GanttCall` on `Batch`, `Applied.gantt`; `_Plan.gantt()` runs after `arrange()`, calls `_own` and always lists the Gantt in `overwrote`, so the room saves a copy first under spec 055's rule.
- `backend/app/api/v1/elements.py`: `POST /boards/{id}/modules`, `PATCH /boards/{id}/modules/{module}`; tasks resolved through the same path as cards (`_tasks`), field ids from what the key reads in Planning; the answer is built from the planned content, not from a read after the write.
- `backend/app/api/mcp.py`: `add_gantt`, `change_gantt` (destructive, not idempotent).
- `backend/app/domain/layout.py`: the module's size, 960×320.
- Rooms need no change: both paths already copy on `overwrote` and write `data.content` as one value. The copy check reads a tab's Gantt as the copy does since PR 411.
