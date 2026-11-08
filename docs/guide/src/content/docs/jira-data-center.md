---
title: Connect Jira Data Center
description: Connect Jira Data Center or Server with your own personal access token.
---

tiko supports Jira Data Center and Server 8.14 and later. It uses your own personal access token, so a Jira admin doesn't need to set anything up.

1. Create a `.env` file next to the compose file with a key that encrypts your token on disk:

   ```bash
   echo "TIKO_SECRET_KEY=$(openssl rand -base64 32)" >> .env
   ```

2. Restart: `docker compose up -d` (add `-f compose.release.yml` if you run from images).
3. In Jira, open your profile → Personal Access Tokens → Create token.
4. In tiko, an admin opens Settings → Task source (main menu or `⌘,`), chooses the Jira provider and enters the base URL (`https://jira.example.com`). Whoever deploys tiko can set both instead with `TIKO_TRACKER=jira` and `JIRA_BASE_URL` in the environment; Task source then shows them read-only. Then each person, the admin included, opens Settings → My tracker, pastes their own token and presses "Test connection". It shows their Jira name.

Cards show each person what their own Jira access allows: a task their token cannot see reads "Not found or no access", and without a token a card shows its key and "Connect your Jira token to see this task". Moving the instance to another Jira URL asks everyone to enter their token again; a token is only ever sent to the URL it was entered for.

Keep `TIKO_SECRET_KEY` safe. If you change or lose it, enter the token again.

Jira Data Center is usually reachable only from the corporate network, so the host running tiko must be able to reach it too. For a corporate certificate authority, see `JIRA_CA_BUNDLE` in [Configuration](../configuration/).

## Start and due dates

A card shows the task's start and due dates when Jira has them. The due date is Jira's own Due date. Jira has no start field of its own, so tiko reads the first filled field named Start date or Target start: projects that keep the start in different fields both work without setup. If your site keeps it in a field with another name, an admin picks that field in Settings → Task source → Start date field.

## Other trackers

The full list, with what is planned, is in [Task trackers](../trackers/).
