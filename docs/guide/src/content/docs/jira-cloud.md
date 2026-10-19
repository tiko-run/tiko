---
title: Connect Jira Cloud
description: Connect a Jira Cloud site with your Atlassian e-mail and your own API token.
---

tiko reads Jira Cloud sites like `https://example.atlassian.net`. Each person signs in with the e-mail of their Atlassian account and an API token of their own, so a Jira admin doesn't need to set anything up.

1. Create a `.env` file next to the compose file with a key that encrypts tokens on disk:

   ```bash
   echo "TIKO_SECRET_KEY=$(openssl rand -base64 32)" >> .env
   ```

2. Restart: `docker compose up -d` (add `-f compose.release.yml` if you run from images).
3. An admin opens Settings → Task source (main menu or `⌘,`), chooses Jira and enters the site address. tiko asks the site which Jira it is and shows "Jira Cloud" under the address. Whoever deploys tiko can set both instead with `TIKO_TRACKER=jira` and `JIRA_BASE_URL`.
4. Each person, the admin included, creates an API token at [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Choose **Create API token**, not the one with scopes.
5. In tiko, they open Settings → My tracker, enter their Atlassian e-mail and the token, save, and press "Test connection". It shows their Jira name.

Cards, links, ranges of keys, JQL queries with suggestions, status timers, the Gantt and public links work as they do with [Jira Data Center](../jira-data-center/). Links copied from a Jira board, with `selectedIssue` in them, become cards too. See [What you can add](../what-you-can-add/).

## Good to know

- **Tokens expire.** Atlassian sets an expiry date on every API token, a year by default. When yours runs out, the sync indicator says Jira rejected the token: create a new one and save it in My tracker.
- **Your token reads what you can see.** A task your account cannot open reads "Not found or no access". Teammates without a token see the key and "Connect your Jira token to see this task".
- **A token is only sent to the site it was entered for.** Moving the instance to another Jira asks everyone to enter their token again. A team moving from Data Center to Cloud keeps its boards: the keys stay the same, and cards turn live again once people connect.
- **Counts of large queries are estimates.** Jira Cloud counts exactly up to 100 matches; past that the card tool says "About 140 tasks match". The tasks it adds are exact.
- **A query needs a condition.** Jira Cloud refuses a bare `ORDER BY created`; add one, like `project = DEV`.

Keep `TIKO_SECRET_KEY` safe. If you change or lose it, enter the token again.

## Other trackers

The full list, with what is planned, is in [Task trackers](../trackers/).
