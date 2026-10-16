---
title: Gantt module
description: Plan tasks on a timeline right on the board.
---

Add a Gantt from the modules tool (`M`) to plan tasks on a timeline right on the board.

- Drop cards onto the timeline to plan them as bars. Bars keep the live status of their task.
- Nest rows under a parent row; its bar spans its children.
- Mark milestones.
- Draw dependency lines between bars. A line turns amber when a task starts before the one it depends on ends.

Plan dates stay on the board, not in your tracker.

## Stages

With Planning on, a row is cut into stages: discovery, design, build, a pause, or whatever your team calls its phases. An admin turns it on in **Settings → Planning**. It is off by default, and switching it off keeps every stage: the Gantt then shows one bar per task again.

- Drag across free days of a row to add a stage. A click adds one week.
- Click a stage to pick its type or delete it. A bar that has no stages yet reads "No stage" until you pick one.
- Drag a stage to move it, or its ends to change its dates. It stops at its neighbours, so stages never overlap.
- A new stage takes the type that follows the previous one.

Stage types belong to the whole tiko: add one from a stage with **New type**, rename, recolor or archive it in **Settings → Planning**. An archived type stays on the stages that use it, and new stages cannot pick it. A task card dropped into the Gantt becomes a row with one bar, as before.
