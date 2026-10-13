# AGENTS.md — rules for AI agents (Claude Code, Codex)

**tiko** — Open-source infinite canvas for your tasks: live cards from your tracker, arranged the way you think
Profile: **oss** ([strategy](docs/playbook/01-strategy.md)). Research: [docs/research.md](docs/research.md). Idea and scope: [docs/brief.md](docs/brief.md). Full playbook: [docs/playbook/](docs/playbook/README.md).

## Hard rules

1. **Main always runs.** Unfinished work lives in `feat/<slice>` branches. `make check` before every merge.
2. **One slice at a time, end to end** (UI → API → domain). No horizontal layers.
3. **A gate is a stop.** At gates G1–G4 (see the strategy) stop and wait for the human's decision.
4. **One command to run:** `docker compose up --build` on a clean machine, following the README.
5. **Works without keys.** Everything external sits behind a port with a mock implementation. Secrets live only in ENV.
6. **Disclose third-party code** in `THIRD_PARTY.md` (libraries, models, datasets).
7. No `git push --force`, `reset --hard`, or deleting branches and tags unless the human explicitly asks.
8. **The repository goes public with its whole history.** No tokens, internal URLs, colleagues' names, real data or screenshots of work systems in commits, tests or fixtures — only made-up data.
9. **Licenses.** The project is AGPL-3.0-only. A new dependency must be permissive or weak copyleft (`make licenses`), so the code can still be dual licensed; no proprietary SDKs that need a production key. A user-visible change gets a line in `CHANGELOG.md` (`Unreleased`).
10. **Everything in the repository is in English**: code, docs, specs, commits, PRs, UI text.

## Principles

- **Think before coding.** State your assumptions. If something is unclear, ask instead of guessing.
- **Simplicity.** Minimum code for the task. No features or abstractions "for later". Won't items from the brief are not built.
- **Surgical changes.** Touch only what is needed, in the style of the surrounding code.
- **Verifiable goals.** Every task has a checkable done criterion (test, curl, screenshot). Prove the result with output.
- **Contract-first.** The API contract (`specs/*/contracts/`) changes only deliberately and with notice.
- **Stay in your zone** when working in parallel.
## UI

Before UI work read [DESIGN.md](DESIGN.md) (missing → create it per [10-design.md](docs/playbook/10-design.md)). Components come from shadcn in `frontend/src/components/ui/`, colors from theme tokens. New screen — `/hallmark`, polish — `/impeccable`, slice check — `/ui-review`.

## Code graph

The repo is indexed by [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp),
wired as the `codebase-memory` MCP server in `.mcp.json`. Install it once per machine
(`codebase-memory-mcp install`, then restart the agent); the graph itself lives in a per-user
cache, not in the repo. Prefer the graph over grep for structural questions:

| Question | Tool |
|---|---|
| Who calls this / what breaks if I change it? | `trace_path` (`direction: inbound\|outbound`) |
| What is this codebase? Which layers, entry points, hotspots? | `get_architecture` (`aspects: all`) |
| Find a symbol by name | `search_graph` with `query` (BM25) |
| Where is this concept / text? | `search_code` |
| What does my branch change affect? | `detect_changes` (`scope: impact`) |
| Is this change architecturally safe? | `query_graph` for `IMPORTS` edges |

**Do not use `search_graph`'s `semantic_query`** — vector search returns noise on this version
(upstream [#1417](https://github.com/DeusData/codebase-memory-mcp/issues/1417), [#1402](https://github.com/DeusData/codebase-memory-mcp/issues/1402)
for non-English). Use BM25 `query` or `search_code` instead; it ranks correctly.

Grep stays for exact string and regex work. The graph wins on relationships: it resolves call
targets that grep reports falsely (e.g. a local variable sharing a function's name).

Scope: `.cbmignore` keeps the graph to product code — `site/`, `brand/`, `specs/`, `.specify/`,
`.agents/` and `install/` are scaffolding, not application code. Reindex after changing it:
`codebase-memory-mcp cli index_repository --repo-path .`

## Coding standards

In full: [docs/playbook/04-coding-standards.md](docs/playbook/04-coding-standards.md). In short:

- A comment explains *why*, not *what*. Usually one line. Docstrings only on public API, one line.
- No commented-out code or decorative banners.
- Formatting and linting by tools (`make fmt`), not by hand.

## Architecture

In detail: [docs/playbook/03-architecture.md](docs/playbook/03-architecture.md).

```text
backend/app/api/       HTTP: routes, schemas, error mapping
backend/app/domain/    business logic, ports, domain errors — tests live here
backend/app/adapters/  port implementations (including mock)
backend/app/config.py  ENV, single entry point
frontend/src/          React/TS: api/ (zod), components/ui/ (shadcn), lib/, index.css (theme)
```

Dependencies: `api → domain ← adapters`. The domain does not import FastAPI or provider SDKs.

## Commands

| Command | What it does |
|---|---|
| `make check` | lint + tests — the gate before merge |
| `make licenses` | dependency licenses compatible with AGPL-3.0 and dual licensing |
| `make up` / `make down` | start / stop compose |
| `make smoke` | core scenario against the running stack |
| `make dev-api` / `make dev-web` | local run with hot reload |
| `make fmt` | auto-format |

## Pipeline

The phase is in `.launch/state.json`. Continue with the `/pipeline` skill (Claude) or by hand following the table in [docs/playbook/README.md](docs/playbook/README.md). Specs: spec-kit in `specs/`, principles: `.specify/memory/constitution.md`.

## Experience

The experience library is `library/` in launchpad (path: `launch home`). Before choosing a tool or when an error looks strange, search it (`rg -il '<key>' "$(launch home)/library"`). New pitfalls and findings — `/lib-add`, project results — `/retro`.

## Definition of Done for a task

- [ ] Done criterion met and shown (test output / curl / screenshot)
- [ ] `make check` green
- [ ] Main runs
- [ ] New ENV variables in `.env.example` and README
- [ ] New dependencies in `THIRD_PARTY.md`, `make licenses` green
- [ ] User-visible change in `CHANGELOG.md`
- [ ] Conventional commit message
