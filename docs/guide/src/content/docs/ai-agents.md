---
title: Connect your AI agent
description: Let Claude, Codex, Copilot or Cursor read your boards over MCP.
---

tiko speaks MCP, the protocol AI agents use to reach other tools. Connect your agent and ask it about your boards in plain words: "what is in progress on the release board?", "which tasks on my plan are overdue?". It reads the board as you laid it out, with the live status of every card.

tiko itself runs no AI model and sends nothing to any AI provider. What the agent reads leaves tiko through the agent, to whatever model it uses, so connect only an agent you trust with those boards.

## What you need

- An [API key](../api-keys/). A key for chosen boards keeps the agent to those boards.
- Your tiko's address with `/api/mcp` at the end, such as `https://tiko.example.com/api/mcp`.

The agent can list your boards, read one (an outline of its frames, one frame, or every element), and search your tasks in Jira or CalDAV. It reads only; it changes nothing.

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

- `401`: the key is missing, wrong, expired or revoked. Make a new one in Settings → API keys.
- `403 api_disabled`: your admin has switched API keys off.
- The agent sees fewer boards than you: the key is for chosen boards, or a board is shared with you in a way the key does not reach. A key gives an admin no more than any member.
- The agent gets "rate_limited": you get 120 reads and 20 task searches a minute, counted for you across all your keys. It may try again shortly.
