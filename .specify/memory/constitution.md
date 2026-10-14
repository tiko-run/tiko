# tiko Constitution

## Core Principles

### I. Main Always Runs (NON-NEGOTIABLE)
`main` always builds, starts and passes `make check`. Work in progress lives in `feat/<slice>` branches and merges only after its slice gate passes.

### II. One-Command Run, Works Without Keys (NON-NEGOTIABLE)
The project starts with `docker compose up --build` on a clean machine by following the README literally. Every external service sits behind a port with a mock implementation, so the core scenario runs without API keys or network.

### III. Hypothesis-Driven Scope
Every feature traces back to the core scenario and success signal in `docs/brief.md`. Items listed under Won't are not built. When time runs short, scope is cut, not the quality floor.

### IV. Vertical Slices
Work is delivered as end-to-end slices (UI → API → domain → storage), each independently runnable and demonstrable. No horizontal layers without a visible result.

### V. Contract-First, Ports and Adapters
The API contract (`specs/*/contracts/`) is fixed before implementation. Layers: `api → domain ← adapters`. The domain never imports HTTP frameworks or provider SDKs.

### VI. Production Feel, Minimal
`/health`, `/ready`, `/metrics`, JSON logs with request id, a unified error format, timeouts on every external call, input validation, and masking of personal data before it leaves the system.

### VII. Clean, Idiomatic Code
Code follows `docs/playbook/04-coding-standards.md`: English identifiers and comments, comments only where they explain *why*, formatter and linter clean, small focused functions, no dead code.

### VIII. Verifiable Tasks
Every task has a checkable done criterion (test, curl, screenshot). Unit tests cover the domain; `make smoke` covers the core scenario; AI/ML parts have an eval with numbers.

## Constraints

- Default storage is SQLite; heavier infrastructure needs a recorded reason in `docs/decisions.md`.
- Deferred by default: auth, roles, multi-tenancy, payments, admin panels, i18n — unless the hypothesis cannot be tested without them.
- Every third-party library, model and dataset is disclosed in `THIRD_PARTY.md`.
- Secrets never enter git; configuration comes from environment variables with safe defaults.
- Usage stats are anonymous counts, on by default, documented field by field in the guide and off with one setting; error reports are off by default. Nothing personal leaves an instance (spec 025).

## Development Workflow

- Specs: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → implementation slice by slice.
- `tasks.md` is organized by slices that follow the core scenario; `[P]` marks tasks safe to run in parallel.
- Gates G1 (scope), G2 (spec), G3 (each slice), G4 (ship) require human approval.
- Conventional commits in English. Process reference: `docs/playbook/`.

## Governance

This constitution guides all specs, plans and reviews. Amendments are recorded in `docs/decisions.md` with a reason; methodology changes go upstream to launchpad.

**Version**: 1.0.0 | **Profile**: oss
