---
title: What you can add
description: What the card tool takes for each tracker, from keys and links to ranges and queries.
---

Pick the card tool (`C`) and type into its field, or paste on the board with `⌘V` (`Ctrl+V`). Up to 50 cards go on the board at a time.

## Any tracker

- **Several at once**, separated by commas or spaces: `DEV-12, DEV-15`.
- **A range** for every task in between: `DEV-1 - DEV-20` or `DEV-1..20`.
- **GitHub tasks** work on every tiko, whatever tracker is connected: see [GitHub](#github).

## Jira Data Center and Jira Cloud

| What | Example |
|---|---|
| A key, in any case | `DEV-12`, `dev-12` |
| A link to the task | `https://jira.example.com/browse/DEV-12` |
| A link copied from a Jira board | `…/boards/7?selectedIssue=DEV-12` |
| A JQL query | `project = DEV AND status = "In Progress"` |

The field suggests fields, operators and values as you type a query, and shows how many tasks match before you press Enter. The first 50 go on the board. On Jira Cloud the count of a large query is Jira's estimate and reads "About 140 tasks match".

A link must point at the Jira tiko is connected to. Setup: [Jira Data Center](../jira-data-center/), [Jira Cloud](../jira-cloud/).

## GitHub

| What | Example |
|---|---|
| A short key | `owner/repo#12` |
| A link to an issue or a pull request | `https://github.com/owner/repo/pull/12` |
| A range | `owner/repo#3 - #9` |

There are no queries for GitHub. Setup: [GitHub Issues](../github-issues/).

## Demo tasks

Keys `DEMO-1` to `DEMO-12`. A query like `project = DEMO` adds all twelve; words in quotes keep the tasks that contain them: `summary ~ "deploy"`.

## Other trackers

The list of trackers, with what is planned, is in [Task trackers](../trackers/).
