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

## People on stages

Each stage can name the people planned for it. They come from one list for the whole tiko, in **Settings → Planning → People**, also under **⋯ → People** in the Gantt controls. Most of them never sign in, so this list is separate from the accounts in **Settings → People**.

- Type a name in a stage's popover to pick someone from the list.
- A name nobody has yet offers **Add "Name" to people**.
- Assignees of the tasks in this Gantt who are not in the list show as **From tracker**. Picking one adds them; nobody is imported until you pick them.

The tracker's assignee and the stage's people are independent: the tracker says who owns the task now, a stage says who is planned for that phase. Names show after the stage type, or centered under each stage with **⋯ → Under each stage**. When they do not fit, the stage shows a people icon with a count; click the stage for the list. An archived person stays on old stages, muted, and is not offered again. Someone viewing a public link sees the names but cannot change them.
