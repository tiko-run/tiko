---
title: Working days and time off
description: Hide weekends, mark days off and people's time off, and see each person's workload.
---

:::note[Needs Planning]
An admin turns Planning on in **Settings → Stages and people**. It is off by default; on the [public demo](https://demo.tiko.run) it is always on.
:::

## Working days

With Planning on, **⋯ → Working days only** hides Saturdays and Sundays from a Gantt. Stages snap to working days, a click on free days adds five of them, and every date range counts working days only: "Mon Oct 12 – Fri Oct 16 · 5 days".

Days off are holidays for the whole tiko, such as a national holiday or a team day. Add them in **Settings → Stages and people → Days off**. On a Gantt with working days only, a day off is shaded like a weekend and does not count, so a stage across it lasts one day less.

With **Weeks**, the header shows months over weeks, and each week reads by its dates, such as 5–9 and 12–16. A week belongs to the month most of its days are in.

## Time off

Time off belongs to a person, not to a board: mark it once and every Gantt where that person has a stage shows it. tiko keeps only the dates, never the reason.

- In **Settings → Stages and people**, open **Time off** under a person and pick the first and last day.
- When someone on the Gantt is away inside its dates, a **Time off** lane appears above the rows. Drag across it, or click it for a week, and pick who is away. Ranges that overlap stack.
- Click a range on the lane to remove it.

A stage whose person is away on any of its days gets a red outline and a "!" before its type. Its tooltip and popover say who is away and when, for example "Anna is away Mon Oct 5 – Fri Oct 9". Remove the time off or move the stage and the warning goes.

## Workload

Open **Settings → Stages and people** and click the calendar button next to a person to see their next twelve weeks across every board. Each week shows how many stages the person has; a week turns red when two stages fall on the same working day, and a week with time off is hatched. Below the weeks, every stage is listed with its type, row, board and dates. Click one to open its board.

A stage on a board you cannot open shows only "Busy" and its dates.
