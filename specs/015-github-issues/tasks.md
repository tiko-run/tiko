---
description: "Task list for GitHub Issues"
---

# Tasks: GitHub Issues

**Input**: [spec.md](spec.md), [plan.md](plan.md), [contracts/api.md](contracts/api.md)

**Tests**: included in every slice, against a mock GitHub; fixtures and screenshots with made-up repositories and people only.

## Format: `[ID] [P?] [Story] Description`

- Backend paths under `backend/app/`, frontend paths under `frontend/src/`

## Phase 1: Slice `feat/github-issues` — a public issue is a live card (US1) 🎯

**Goal**: paste a link to a public issue or pull request on any instance and get a live card.

- [x] T001 [US1] One live read of a public issue list: confirm `pull_request.merged_at`, `draft` and `state_reason` are in it; write the result into `plan.md`
- [x] T002 [P] [US1] `domain/errors.py`: `TrackerUnavailable`, `TrackerRateLimited`, `TrackerUnreachable` as bases of the Jira errors; `domain/refresh.py` backs off on the bases. Tests: Jira codes and backoff unchanged
- [x] T003 [P] [US1] `domain/tasks.py`: GitHub key pattern, parsing of links and keys (issue, pull request, comment and files links), key validation by source; `domain/boards.py` and `domain/modules/gantt.py` use it. Tests: a stored board of spec 013 validates unchanged
- [x] T004 [US1] `adapters/tasks/github.py`: mapping of an issue and a pull request to `Task` (statuses of decisions 5 and 6), `resolve`, `poll` by repository with `since`, `check`; limit, outage and network errors. Tests on recorded made-up answers
- [x] T005 [US1] The shared reader: memory per repository, the pace without a token, ETags and the board's pace with `GITHUB_TOKEN`, the private check, the cap on repositories, dropping idle ones. Tests with a fake clock (SC-003)
- [x] T006 [US1] `config.py` (`github_token`), `api/deps.py` (`github` in `providers()`), `api/tasks.py` (resolve by shape), `api/public.py` (GitHub tasks in full for a guest), the `note` of a source. API tests with a mock GitHub
- [x] T007 [P] [US1] `sources/registry.ts` with `github` and a mark per theme, `SourceMark` picks by theme; `THIRD_PARTY.md`, `TRADEMARKS.md`. Tests
- [x] T008 [P] [US1] `canvas/refs.ts` and paste: GitHub links and keys become cards with `source: "github"`; `TaskBits`: icons for "Issue" and "Pull request", the short key on the card. Tests
- [x] T009 [US1] The sync list shows the source's note; the card tool, the context menu, the shortcuts list and the palette say "Task card". Tests
- [x] T010 [US1] `scripts/smoke.py`: a GitHub key reaches the GitHub source (the stack has no mock GitHub, so the answer itself is covered by the API tests); `.env.example` and the guide carry `GITHUB_TOKEN`
- [x] T011 [US1] Checked on the compose stack against the real GitHub with no token, in both themes: issues and pull requests of `tiko-run/tiko` by link and by key show their kinds and statuses ("planned" and "in progress" from labels, Merged, Open), the mixed board carries the marks, the sync list has the GitHub row with its note, a guest of the public link sees the cards in full (SC-001, SC-006). The used-up limit, the pace over an hour and a changed issue are covered by the tests with a fake GitHub and a fake clock (SC-002, SC-003); a paste on the board was checked by its tests, not by hand. `make check` and `make smoke` green; no new dependency, so `make licenses` is unchanged
- [x] T012 [US1] Guide page "GitHub Issues", `CHANGELOG.md`, `docs/brief.md`

## Phase 2: Slice `feat/github-labels` — labels and the author in the mini-card (US2)

**Goal**: the mini-card shows what only GitHub has.

- [x] T013 [US2] `Task.labels` and `Task.rows`; the GitHub adapter fills them; `api/tasks.ts` schema with empty defaults. Tests: an old cached task reads with empty lists
- [x] T014 [US2] `CardDetails`: chips and extra rows, no Priority row without a priority. Tests
- [x] T015 [US2] `DESIGN.md`: chips in the mini-card, the label color exception
- [x] T016 [US2] Checked on the compose stack against the real GitHub in both themes: the mini-cards of `tiko-run/tiko` issues and a pull request show their labels as chips (pale, saturated yellow and violet with white text), the Author row and no Priority row. A mini-card of a task without labels is covered by its test, not compared by pixels with the previous release. `/ui-review` is not installed here and was not run. `make check` green
- [x] T017 [US2] Guide, `CHANGELOG.md`

## Phase 3: Slice `feat/github-token` — private repositories (US3)

**Goal**: a person's own token opens their private repositories to them only.

- [ ] T018 [US3] `domain/settings.py` and `api/me.py`: a token per source for a person (save, test, remove), bound to api.github.com. Tests
- [ ] T019 [US3] `api/deps.py`: a person with a token gets their own `GitHubProvider`; without one, a task the shared reader cannot read comes back `no_token`. Tests with a mock private repository, two people
- [ ] T020 [US3] `api/public.py` and `domain/public.py`: a guest gets `private` for what the shared reader cannot read. The byte test of spec 012 on a board with a private GitHub task (SC-005)
- [ ] T021 [P] [US3] Settings → My tracker: the GitHub token block. Tests
- [ ] T022 [US3] Check on the compose stack: owner, a second person and a guest on one board with a private task. `make check`, `make smoke` green
- [ ] T023 [US3] Guide (which token to create and with what access); how a team shares private tasks; one limit per GitHub user), `CHANGELOG.md`. See "Open points" in the spec
