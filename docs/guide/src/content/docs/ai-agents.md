---
title: Connect your AI agent
description: Let Claude, Codex, Copilot or Cursor read and arrange your boards over MCP.
---

tiko speaks MCP, the protocol AI agents use to reach other tools. Connect your agent and ask it about your boards in plain words: "what is in progress on the release board?", "which tasks on my plan are overdue?". It reads the board as you laid it out, with the live status of every card.

:::caution[What the agent reads leaves tiko]
tiko itself runs no AI model and sends nothing to any AI provider. What the agent reads leaves tiko through the agent, to whatever model it uses, so connect only an agent you trust with those boards.
:::

## What you need

- An [API key](../api-keys/). A key for chosen boards keeps the agent to those boards.
- Your tiko's address with `/api/mcp` at the end, such as `https://tiko.example.com/api/mcp`.

## What the agent can do

With any key, the agent can:

- **List your boards** and **read one:** an outline of its frames, one frame, or every element, narrowed down to what it needs, such as the done cards outside frames.
- **Read a Gantt plan** with its live tasks, stages and people: "what is late on the release plan?". A big plan comes as its top rows first, and the agent reads on by branch or by dates.
- **See how busy someone is:** "is Mira overloaded in December?".
- **Search your tasks** in Jira or CalDAV.

With a key that can also write, it can:

- **Make and rename boards**, add cards, notes and frames, and draw arrows with words on them.
- **Put code next to the plan:** "add the config you changed next to DEMO-7, mark the line with the port". The block comes colored in its language, with the lines that matter marked.
- **Lay cards out** in rows or a column per status, sorted by key or status, in as many columns as fit a frame: "put DEMO-1 to DEMO-12 in the narrow frame, by key, and fit the frame". New cards, notes and frames can land exactly where the agent puts them.
- **Keep a Gantt plan current:** "from these notes: add DEMO-14 under Payments, move Search two weeks later". It adds, moves and removes rows, shifts dates and links rows to tasks, all in one change. A plan someone made by hand needs a key with full access, and tiko saves a copy of the board before every change to a plan.
- **Tidy what is there:** colours, bold, text size, opacity, rotation: "make the headings bold and colour the blocked frame pink".
- **Set reminders,** at a time or for when a task on the board moves: "remind me at 3 pm to call about DEMO-4", "tell me when DEMO-2 leaves In progress". A reminder rings in tiko while the board is open in a tab; the agent cannot reach you anywhere else.

What people made stays theirs: the agent may move and restyle your elements, but it changes the words of, and removes, only what was added through the API with your keys. Notes people made by hand keep their text whatever it is told. A key with full access, if your admin allows it, may also rename your frames and clear old elements; tiko saves a copy of the board first, and you put the board back from **Saved copies** in the board menu, or the agent does.

:::tip[Start with a key that only reads]
Give one that writes when you want the agent to arrange things.
:::

The same calls are open to scripts: see [API](../api/) and the [API reference](../reference/).

## Claude Code

```bash
claude mcp add --transport http tiko https://tiko.example.com/api/mcp \
  --header "Authorization: Bearer tiko_…"
```

## Codex

In `~/.codex/config.toml`, with the key in the environment variable `TIKO_API_KEY`:

```toml
[mcp_servers.tiko]
url = "https://tiko.example.com/api/mcp"
bearer_token_env_var = "TIKO_API_KEY"
```

## VS Code

In `.vscode/mcp.json`. VS Code asks for the key the first time and keeps it out of the file:

```json
{
  "inputs": [
    { "type": "promptString", "id": "tiko-key", "description": "tiko API key", "password": true }
  ],
  "servers": {
    "tiko": {
      "type": "http",
      "url": "https://tiko.example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${input:tiko-key}" }
    }
  }
}
```

## Cursor and other agents

Any agent that connects to a remote MCP server over HTTP and sends a header works: give it the address and the header `Authorization: Bearer tiko_…`. Cursor takes both in its MCP settings; see Cursor's own docs for where.

## Claude Desktop

Claude Desktop reaches remote servers through the [mcp-remote](https://github.com/geelen/mcp-remote) bridge, which needs Node.js. In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tiko": {
      "command": "npx",
      "args": ["mcp-remote", "https://tiko.example.com/api/mcp", "--header", "Authorization:${TIKO_AUTH}"],
      "env": { "TIKO_AUTH": "Bearer tiko_…" }
    }
  }
}
```

The header has no space after the colon and `Bearer` sits in the variable: on Windows a space in the arguments breaks the header.

## claude.ai and ChatGPT

Both connect from their own cloud, so your tiko must be reachable from the internet.

- **claude.ai**: on plans where custom connectors take request headers, add the address and `Authorization: Bearer tiko_…` as a header. Everyone in the organization then uses that one key, so make it a key for chosen boards that everyone there may see.
- **ChatGPT** signs in to connectors only with OAuth, which tiko does not offer yet.

## When it does not connect

| The agent gets | Why | Fix |
|---|---|---|
| `401` | The key is missing, wrong, expired or revoked | Make a new one in **Settings → API keys** |
| `403 api_disabled` | Your admin has switched API keys off | Ask your admin |
| Fewer boards than you see | The key is for chosen boards, or a board is shared with you in a way the key does not reach. A key gives an admin no more than any member. | Make a key for all your boards |
| `rate_limited` | You get 120 reads and 20 task searches a minute, counted for you across all your keys | It may try again shortly |
