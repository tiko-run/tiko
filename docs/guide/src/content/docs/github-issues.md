---
title: GitHub Issues
description: Put issues and pull requests of GitHub repositories on a board. Public ones need no token and no setup, private ones your own token.
---

Issues and pull requests of public repositories on github.com become live cards on any tiko. There is nothing to connect: public repositories are read without a token. For private repositories each person adds [their own token](#your-own-token).

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

## Tokens at a glance

GitHub cards work with no token at all. There are two tokens you may add, for two different jobs:

| | No token | Instance token | Your own token |
|---|---|---|---|
| Who sets it | Nobody | Whoever runs tiko | Each person, for themselves |
| Where | | `GITHUB_TOKEN` in the environment | Settings → My tracker |
| Public repositories | Yes | Yes | Yes |
| Private repositories | No | No, never | The ones the token reads, shown to you only |
| How often cards update | Every few minutes | At the board's pace | At the board's pace |
| Whose request limit | 60 an hour for the whole instance | 5000 an hour for the whole instance | 5000 an hour of your own GitHub account |
| Token to create | | Classic, no scopes | Fine-grained, read-only |
| You need it when | You are trying tiko out | The instance has more than a few GitHub cards, or is open to many people | You want private issues and pull requests on a board |
| How to create | | [Instance token](#how-fresh-the-cards-are) | [Your own token](#your-own-token) |

A token is one person's key. Nobody else is added to it, and tiko never shows a private task to one person through another person's token. For a teammate to see your private cards, they add a token of their own.

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

## Your own token

A person adds their own GitHub token in Settings → My tracker. From then on:

- issues and pull requests of private repositories the token can read are live cards, added by link or key like any other;
- all their GitHub cards, public ones too, refresh at the board's pace on the request limit of their own GitHub account, not on the one the instance shares.

The token is stored encrypted, is sent to api.github.com only and is never shown again. tiko asks GitHub about a token before it stores it, and does not keep one GitHub refuses.

### Which token to create

Create a fine-grained token, so that it can only read:

1. Open [New fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) on GitHub.
2. Name it, for example `tiko – read issues`, and choose an expiration.
3. In **Resource owner** choose the account or the organization that owns the repositories. An organization may have to approve the token first.
4. In **Repository access** choose "Only select repositories" and pick the ones you want on your boards.
5. In **Permissions → Repository permissions** set **Issues** and **Pull requests** to "Read-only". GitHub adds "Metadata: Read-only" itself.
6. Press **Generate token**, copy it and paste it into Settings → My tracker.

tiko takes a classic token too. The two kinds differ in how much they open, not in who sees your cards:

| | Fine-grained (recommended) | Classic |
|---|---|---|
| Repositories | The ones you pick, of one owner | Every repository you can reach, of every owner |
| Access | Read-only issues and pull requests | The `repo` scope: full read and write |
| Use it | By default | For repositories of several owners at once, or when your organization does not allow fine-grained tokens |

tiko keeps one GitHub token per person, so with a fine-grained token pick the owner whose repositories you need on your boards.

### What others see

A private task shows in full only to a person whose own token can read it. On the same board:

| Who | What the card shows |
|---|---|
| A person whose token reads the repository | The task in full |
| A person with no GitHub token | The key and "Connect your GitHub token to see this task" |
| A person whose token does not cover the repository | The key and "Not found or no access" |
| A guest of the public link | The key only |

Access follows the token, not membership: a member of the organization whose fine-grained token leaves the repository out sees the key only.

### Sharing private tasks with a team

Everyone on the team adds their own token that reads the repository. There is no token for a whole board: tiko never shows one person's private tasks through another person's token, so a board with private cards is safe to share with people outside the team.

### Limits

GitHub counts requests per account, not per token: a second token of yours does not add to the 5000 an hour, and your other tools spend the same limit. tiko stops asking when a tenth of your limit is left and starts again when GitHub resets it; the GitHub row of the sync indicator says so, and cards keep their last data meanwhile.

If GitHub rejects your token (it expired or you revoked it), public cards keep updating without it, private ones show the key, and the GitHub row says "GitHub rejected your token". Enter a new one in Settings → My tracker.

## Public links

A guest of a board's public link sees GitHub cards of public repositories in full: they are public anyway. A card of a private repository shows a guest its key only, whoever's token reads it.

## Not yet

- Sign-in with GitHub in place of a pasted token.
- Several GitHub tokens for one person.
- Adding many issues by a search query.
- GitHub Enterprise Server.
