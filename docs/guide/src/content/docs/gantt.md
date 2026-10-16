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

With Planning on, a row is cut into stages: discovery, design, build, a pause, or whatever your team calls its phases. An admin turns it on in **Settings → Stages and people**. It is off by default, and switching it off keeps every stage: the Gantt then shows one bar per task again.

- Drag across free days of a row to add a stage. A click adds one week.
- Click a stage to pick its type or delete it. A bar that has no stages yet reads "No stage" until you pick one.
- Drag a stage to move it, or its ends to change its dates. It stops at its neighbours, so stages never overlap.
- A new stage takes the type that follows the previous one.

Stage types belong to the whole tiko: add one from a stage with **New type**, rename, recolor or archive it in **Settings → Stages and people**. An archived type stays on the stages that use it, and new stages cannot pick it. A task card dropped into the Gantt becomes a row with one bar, as before.

## People on stages

Each stage can name the people planned for it. They come from one list for the whole tiko, in **Settings → Stages and people**, also under **⋯ → People** in the Gantt controls. Most of them never sign in, so this list is separate from the accounts in **Settings → People**.

- Type a name in a stage's popover to pick someone from the list.
- A name nobody has yet offers **Add "Name" to people**.
- Assignees of the tasks in this Gantt who are not in the list show as **From tracker**. Picking one adds them; nobody is imported until you pick them.

The tracker's assignee and the stage's people are independent: the tracker says who owns the task now, a stage says who is planned for that phase. Names show after the stage type, or centered under each stage with **⋯ → Under each stage**. When they do not fit, the stage shows a people icon with a count; click the stage for the list. An archived person stays on old stages, muted, and is not offered again. Someone viewing a public link sees the names but cannot change them.

## Columns

With Planning on, a Gantt can show fields as columns between the task titles and the timeline: Priority, Size, Team, or any field of your own, such as Quarter or Budget code.

- Click **+** at the end of the column headers to show or hide a field, or type a new one. A Gantt shows up to 6 columns.
- Type a value straight into a cell, up to 100 characters. Enter or a click elsewhere saves it, Escape keeps the old one.
- An empty cell shows the parent row's value in gray. Type a value to override it for that row and its children; clear it to inherit again.

Fields belong to the whole tiko, so every Gantt can show the same ones; values live in the rows of each Gantt and never go to the tracker. Rename fields or add your own in **Settings → Stages and people → Fields**. Archiving a field of your own keeps the values in the rows. Priority, Size and Team can be renamed but stay.

## Filters and views

With Planning on, a strip above the Gantt filters its rows by any field or by person.

- Click **+ Filter**, pick a field or **Person**, then tick the values. Click a chip to change its values, or its **×** to drop it.
- Values of one field match any of them; different fields must all match. A value such as "Q4, Q1" matches each part.
- Filters use inherited values, so a child matches its parent's Quarter. The parents of matching rows stay visible.
- **Team** also matches rows where a person of that team has a stage, so you can see where a team takes part across other teams' tasks.

The filters belong to the Gantt, like its scale. **Save as view** stores them under a name for the whole tiko; every Gantt lists saved views as pills above its rows. Click a pill to apply it, click it again to show every task. Delete views in **Settings → Stages and people → Views**.

## Time off

Time off belongs to a person, not to a board: mark it once and every Gantt where that person has a stage shows it. tiko keeps only the dates, never the reason.

- In **Settings → Stages and people**, open **Time off** under a person and pick the first and last day.
- When someone on the Gantt is away inside its dates, a **Time off** lane appears above the rows. Drag across it, or click it for a week, and pick who is away. Ranges that overlap stack.
- Click a range on the lane to remove it.

A stage whose person is away on any of its days gets a red outline and a "!" before its type. Its tooltip and popover say who is away and when, for example "Anna is away Mon Oct 5 – Fri Oct 9". Remove the time off or move the stage and the warning goes.
