---
title: Move a board to another tiko
description: Export a board as a .tiko file and import it on any other tiko, with its pictures, Gantts and cards.
---

A board you built on one tiko can move to another: from a laptop to the team's server, or from home to the tiko in your company's network. The two never need to see each other. The board travels as one file.

## Export

Open the board's menu, by its name in the top bar or by `⋯` on Home, and pick **Export board**. The browser saves `<board name>.tiko`. Everyone who can open the board can export it; a guest of a public link cannot.

## Import

On Home, press **Import** next to New board and pick the file, or drop a `.tiko` file anywhere on Home. tiko makes a new board of yours from it, in the folder that is open, and opens it. An import never changes a board that is already there, and importing one file twice gives two boards.

A short report sits at the top right of the new board. It says what moved and what still needs a hand, each with a button to the place that fixes it. Close it when you are done; it does not come back.

## What moves

| On the board | After the import |
|---|---|
| Stickies, shapes, text, frames, arrows, styles, rotation | as they were |
| Pictures and GIFs | stored on this tiko with their full quality |
| Stickers | as they were |
| Gantts | with their rows, stages, milestones and links |
| Stage types, people and fields of the Gantts | matched by name to this tiko's [Planning](/gantt/stages/); missing ones are added, with the people's teams and time off |
| Reminders | as they were |
| Task cards | live once this tiko reads their tracker, see below |
| The board's name and view | as they were |

What belongs to people of the old tiko stays there: reactions, votes, who the board is shared with, the public link, stars and folders.

## Task cards

A card keeps its tracker and key. When this tiko reads that tracker and you have access, the card goes live on the next refresh.

When it does not, the card shows the task as it was at export, its title and status greyed, with what to connect: "Jira is not connected here" opens Settings → Task source, "Connect your GitHub token" opens Settings → My tracker. Once the tracker is connected, the cards go live by themselves; nothing has to be imported again.

tiko cannot tell whether the Jira here is the same Jira as at home. If both know a key such as `OPS-7`, the card shows this tiko's `OPS-7`.

## Planning

A Gantt's stage types, people and fields are matched by name: "Build" on the old tiko becomes "Build" here. Missing ones are added, and the report lists them. A person who is already here keeps everything they have; time off from the file is added only where it does not overlap theirs.

If Planning was off where the board was exported, the file does not describe the stages; the report says so, and turning Planning on there and exporting again fixes it.

If Planning is off here, the Gantts arrive with their rows and dates, without stage types and people. A workspace admin turns Planning on in Settings; import the board again after that.

## When an import stops

An import either makes the whole board or nothing. It stops and says why when:

- the file is not a tiko board, or is damaged: export it again;
- the file comes from a newer tiko: update this one first;
- the file is over 300 MB, or the pictures need more room than the workspace has left;
- you already own as many boards as an account here can.

A single picture this tiko cannot take does not stop the board: it stays an empty frame of its size that asks you to pick the file again, and the report names the reason.

## The file

A `.tiko` file is a zip you can open with any archive tool:

| Entry | What it holds |
|---|---|
| `manifest.json` | format version, the tiko version that wrote it, the export time, the board name and the pictures' types |
| `board.json` | the board document, as the API saves it |
| `tasks.json` | the last seen title, status and fields of each task on the board |
| `planning.json` | the stage types, people and fields the board's Gantts use |
| `files/<id>` | the original bytes of each picture |

The file holds what the board shows, task titles included. Treat it like the board itself when you send it to someone.
