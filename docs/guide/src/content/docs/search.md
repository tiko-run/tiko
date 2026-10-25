---
title: Search and commands
description: Find anything on a board, filter cards and run commands from one palette.
---

Press `⌘K` (`Ctrl+K`) to open the palette. It finds any text on the board, cards by key, title, status or assignee included, and moves the board to the match. `⌘Enter` selects all results.

## Filters

Type a filter and pick a value from the suggestions; it turns into a chip.

| Filter | Example |
|---|---|
| Assignee | `@anna` |
| Status | `status:review`, `status:"in review"` |
| Type | `type:bug` |
| Priority | `priority:high` |
| Frames and modules only | `#sprint` at the start |

Several chips of the same field match any of them; different fields must all match. Backspace in an empty input turns the last chip back into text.

## Commands and boards

The same palette runs app commands: add a card, sticky note, frame, reminder or module, switch the theme, open settings, create or rename a board. Each command shows its shortcut. Other boards whose name matches appear as "Go to board".

Start the query with `>`, or press `⌘P` (`Ctrl+P`), to list only commands and boards.
