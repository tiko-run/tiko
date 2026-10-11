---
title: GitHub Issues
description: Put issues and pull requests of public GitHub repositories on a board, with no token and no setup.
---

Issues and pull requests of public repositories on github.com become live cards on any tiko. There is nothing to connect: public repositories are read without a token.

## Add a card

Copy the link of an issue or a pull request and paste it on the board with `⌘V` (`Ctrl+V`), or pick the card tool (`C`) and type the link or `owner/repo#12`. Several at once work too.

The card shows the kind (issue or pull request), the short key `repo#12`, the title and the status. Click a card for the mini-card: the full key with the repository, the assignee, the author, the labels as chips in their GitHub colors, and a link to GitHub. On a board that also has tasks of another tracker, GitHub cards carry the GitHub mark.

## Statuses

| On GitHub | On the card |
|---|---|
| Open issue | Open |
| Open pull request | Open, shown as in progress |
| Draft pull request | Draft |
| Merged pull request | Merged |
| Closed pull request or issue | Closed |
| Issue closed as not planned | Not planned |
| Issue closed as duplicate | Duplicate |

Many projects keep the state of an open issue in a label. An open issue with one of these labels shows the label as its status:

- not started: `planned`, `todo`, `to do`, `backlog`
- in progress: `in progress`, `in-progress`, `wip`, `doing`, `in review`
- done: `shipped`, `done`, `released`

A closed issue is always closed, whatever its labels.

## How fresh the cards are

Without a token GitHub allows 60 requests an hour for the whole tiko. tiko spends them one repository at a time, the longest-waiting first: one repository updates about every minute, five about every six minutes. The more repositories on your boards, the less often each one updates. The sync indicator says "Updates every few minutes without a token" on the GitHub row.

To get the board's pace back, whoever runs tiko sets `GITHUB_TOKEN` in the environment (see [Configuration](../configuration/)). The limit becomes 5000 an hour, and a repository where nothing changed costs nothing.

The token needs no access at all: any token raises the limit, and public repositories are readable without permissions. To create one:

1. Open [New personal access token (classic)](https://github.com/settings/tokens/new) on GitHub.
2. Name it in **Note**, for example `tiko – public read-only`.
3. Set **Expiration** to "No expiration", or pick a date and replace the token before it.
4. Leave every scope unchecked.
5. Press **Generate token** and copy it: GitHub shows it once.

A fine-grained token with "Public repositories (read-only)" access and no permissions works the same way.

To check the token before you set it, ask GitHub for the limit; the answer is `5000`:

```bash
curl -s -H "Authorization: Bearer <token>" https://api.github.com/rate_limit | jq .rate.limit
```

The token is shared by everyone on the instance, so tiko never shows a private repository through it, even if the token could read one.

If the limit does run out, the GitHub row turns red and says when the next try is. Cards keep their last data, and other trackers sync as usual.

## Public links

A guest of a board's public link sees GitHub cards of public repositories in full: they are public anyway.

## Not yet

- Private repositories, with a personal token per person.
- Adding many issues by a search query.
- GitHub Enterprise Server.
