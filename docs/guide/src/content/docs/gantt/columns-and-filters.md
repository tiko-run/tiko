---
title: Columns, filters and views
description: Show fields as columns, filter the rows and save filters as views.
---

:::note[Needs Planning]
An admin turns Planning on in **Settings → Stages and people**. It is off by default; on the [public demo](https://demo.tiko.run) it is always on.
:::

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
