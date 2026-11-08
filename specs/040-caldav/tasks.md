# Tasks: CalDAV tasks as cards

## Slice 1: caldav-connect

- [ ] T001 Address rules: HTTPS for public hosts, plain HTTP only to private networks, `TIKO_CALDAV_PRIVATE_NETWORK=deny` refuses private networks, every redirect checked; demo sets deny (FR-003)
- [ ] T002 CalDAV client: discovery from a domain or a full address through `/.well-known/caldav`, principal, calendar home, task lists only; display name; 401, 404 and no answer mapped to domain errors (FR-002)
- [ ] T003 VTODO to `Task`: status, priority, categories, rows (list, due, start, percent, repeats, parent), dates in English and 24-hour time, Nextcloud Tasks link; `Task.start` / `Task.due` with field names when spec 041 has landed (FR-006, FR-012)
- [ ] T004 Reader: tasks of a list (open, or with done), resolve by UID across lists, poll by change tag of each list, a moved task found again (FR-005, FR-007, FR-008)
- [ ] T005 Personal account in the credential store: connect with a check, replace, remove; list switches kept with it; `caldav` provider per person and a stand-in for people without an account (FR-001, FR-004, FR-009)
- [ ] T006 API: account and list switches under `/me`, tasks of a list under `/tasks/caldav`; no write request to the server (FR-010)
- [ ] T007 Settings → My tracker: CalDAV form and list switches
- [ ] T008 Card tool: CalDAV tab with lists, open tasks, "Show done", tick or add the whole list, up to 50
- [ ] T009 Source mark and short key (list name) on the card
- [ ] T010 Radicale stand for the integration test and a seed script with made-up tasks; Nextcloud stand for the checks by hand
- [ ] T011 By hand on Nextcloud: tasks from Thunderbird, Apple Reminders and the web app show and refresh; results in the PR (FR-011)
- [ ] T012 Guide (CalDAV page, What you can add, Task trackers), `.env.example`, README if needed, `THIRD_PARTY.md`, CHANGELOG

## Slice 2: caldav-more-servers

- [ ] T013 iCloud and Fastmail checked by hand, their setup in the guide
- [ ] T014 Fixes from the preview in discussion #71
