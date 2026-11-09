# Feature Specification: Planning on in a new tiko

**Status**: Approved at G2 on 2026-11-09.

**Input**: People install tiko for its Gantt and find it without stages, people and workload until an admin finds the Planning switch. A board moved from another tiko also loses its stage types and people when Planning is off where it lands.

## Decisions

1. **A new tiko starts with Planning on**, with the default stage types, as if an admin had turned it on. "New" is the start that makes the first admin on an empty database.
2. **A running tiko keeps its switch.** An update, a restart or a move from SQLite to Postgres changes nothing: those starts find people already there. No migration.
3. The demo keeps its own sample planning.

## Requirements

- **FR-001**: The start that creates the first admin MUST turn Planning on with the default stage types.
- **FR-002**: Any later start MUST leave Planning as it is.
- **FR-003**: The guide MUST say Planning is on in a new tiko and how an older one turns it on.
