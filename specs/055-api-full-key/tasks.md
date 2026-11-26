---
description: "Task list for a key with full rights and saved copies"
---

# Tasks: A key with its person's full rights, with a way back

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1: Slice `feat/api-full-key`

- [x] T001 Scope `full`, ranks, workspace setting, migration 014; settings tests
- [x] T002 `batch.py`: `full`, `overwrote`, vote lock first
- [x] T003 `board_copies`, port, adapter, `holds`/`written`, trim and purge, pictures kept
- [x] T004 Rooms: copy before the write, restore, both paths; tests with and without an open tab
- [x] T005 Routes, MCP tools, editable; API and MCP tests
- [x] T006 Settings switch and key dialog (Vitest); contract, OpenAPI snapshot, guide, CHANGELOG
- [x] T007 By hand against a local stack, recorded in the PR

## Phase 2: Slice `feat/board-copies`

- [x] T008 Board menu: Saved copies, list and restore with a confirmation; ships in the same release as phase 1
