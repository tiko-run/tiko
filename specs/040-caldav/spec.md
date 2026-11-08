# Feature Specification: CalDAV tasks as cards

**Status**: Draft, waiting for G1.

**Input**: Issue #327, asked for in discussion #71. People keep their tasks on a CalDAV server, most often Nextcloud, and edit them in Thunderbird, Apple Reminders or the server's web app. They want those tasks on a tiko board as live cards, and they want to choose which task lists tiko shows.

## Why

- Personal and small-team tasks often live outside any tracker, in a CalDAV task list. Today they cannot go on a board next to the work they belong to.
- Which fog does this clear: the to-dos from the phone and the mail client sit on the same board as the tracker's tasks, and stay current without being copied.

## Decisions

1. **One connector for every CalDAV server.** CalDAV is a protocol, so tiko talks to the server, not to an app. Thunderbird, Apple Reminders, DAVx⁵ and the Nextcloud web app are clients of the same server: whatever they write, tiko reads. The first targets are Nextcloud and Radicale, then iCloud and Fastmail. Google Tasks and Microsoft To Do do not serve tasks over CalDAV and are not part of this spec.
2. **The connection is personal.** Each person connects their own account in Settings → My tracker: server address, user name and an app password. Nobody else's account is used to read a task, the same as GitHub and Jira tokens today. An admin sets nothing, and CalDAV works on every tiko whatever tracker the instance is set to. The account is stored encrypted with the instance secret key, like the other tokens. A demo visitor cannot connect one.
3. **One account per person in this spec.** Credentials are stored per person and tracker, so a person has one CalDAV account. Several accounts at once (iCloud and Nextcloud together) need a change to how credentials are stored and come later if people ask.
4. **The address is found for the person.** They may type just the domain (`cloud.example.com`) or a full CalDAV address. tiko follows `/.well-known/caldav` to the principal and its calendar home, and keeps only the collections that hold tasks (VTODO). Saving the connection checks it at once and shows the account's display name, or says what failed: wrong password, no task lists, server not reached.
5. **Where tiko may connect.** A public address must use HTTPS. Plain HTTP is accepted only for a private network address, where a home Nextcloud or Radicale often runs. Private network addresses are allowed by default on a self-hosted instance and switched off by `TIKO_CALDAV_PRIVATE_NETWORK=deny`, which the demo sets. Every redirect is checked by the same rules.
6. **The person chooses the lists.** After connecting, Settings lists the task lists of the account with a switch each, all on at first. Lists switched off are never shown in the card tool. The choice is per person, not per board.
7. **Cards are added from a list, not by typing a key.** A task's id (its UID) is long and nobody types it. When CalDAV is connected, the card tool gets a CalDAV tab: pick a list, see its open tasks, tick some or add the whole list, up to 50 at a time. Done tasks show behind a "Show done" switch.
8. **A card knows its task by its UID.** The card's key is the task's UID. tiko remembers where the task was found; when a client moves it to another list, tiko finds it again by UID among the person's lists. The card shows the list name where other trackers show the key.
9. **How a task reads as a card.**
   - Title: `SUMMARY`.
   - Status: `NEEDS-ACTION` or none → To do; `IN-PROCESS` → In progress; `COMPLETED` → Done; `CANCELLED` → Cancelled (counted as done).
   - Priority: 1–4 High, 5 Medium, 6–9 Low, 0 or none → no priority.
   - Labels: `CATEGORIES`, without colour.
   - The list name stands where other trackers show the key, on the card and in its mini-card. A CalDAV task has no assignee row.
   - Rows: due date, start date, percent complete, "Repeats" for a task with `RRULE`, parent task title for a subtask (`RELATED-TO`). Dates in English and 24-hour time; a date-only due shows no time.
   - Dates for the gantt (spec 041-gantt-dates): `DTSTART` fills `Task.start` and `DUE` fills `Task.due`, as calendar days with the field names `DTSTART` and `DUE`. A date with a time or a time zone becomes its day in the instance's time zone. When `DTSTART` is after `DUE`, only the due date is kept. A missing date stays empty; the gantt fills it in itself.
   - Updated: `LAST-MODIFIED`.
   - Link: on Nextcloud the card opens the task in the Nextcloud Tasks app; on other servers it has no link and "Open in" is hidden.
   - A repeating task shows as one card for the series; occurrences are not expanded.
10. **Refresh is cheap for the server.** Cards refresh at the instance's refresh interval like other cards. tiko asks each list for its change tag first and reads tasks only from lists that changed, and only lists that hold cards on an open board are asked.
11. **Read-only.** tiko never writes to the CalDAV server: no ticking a task done from the board in this spec.
12. **When things fail.** A wrong or revoked password puts the person's CalDAV cards into the "connect again" state, as with an expired token. A server that cannot be reached keeps the last known card with the usual sync status. A task deleted on the server reads as not found.

## Requirements

- **FR-001**: A person MUST be able to connect, replace and remove their own CalDAV account (address, user name, app password) in Settings; the password MUST be stored encrypted and never shown again.
- **FR-002**: Connecting MUST discover the task lists from a domain or a full address through `/.well-known/caldav`, keep only lists that hold tasks, and report the account's display name or the reason it failed.
- **FR-003**: tiko MUST refuse plain HTTP to public addresses, and refuse private network addresses when `TIKO_CALDAV_PRIVATE_NETWORK=deny`, including after a redirect.
- **FR-004**: A person MUST be able to switch each task list on or off; lists switched off MUST NOT appear in the card tool.
- **FR-005**: The card tool MUST let a person add tasks from a chosen list, singly or the whole list, up to 50 at once, with done tasks hidden unless asked for.
- **FR-006**: A card MUST read a task as Decision 9 describes, including date-only and time-zoned due dates, repeating tasks and subtasks.
- **FR-012**: A task MUST fill `Task.start` from `DTSTART` and `Task.due` from `DUE` with the field names `DTSTART` and `DUE`, as Decision 9 describes. Whichever of this spec and 041-gantt-dates lands second wires this in.
- **FR-007**: A card MUST find its task again by UID after the task moves to another list of the same account.
- **FR-008**: Refresh MUST skip lists whose change tag did not change and MUST ask only lists that hold cards on an open board.
- **FR-009**: A card MUST be read only with the viewing person's own account; a person without access to the list sees the card's key only.
- **FR-010**: tiko MUST NOT send any write request to a CalDAV server.
- **FR-011**: Tasks made in Thunderbird, Apple Reminders and the Nextcloud Tasks app on a Nextcloud server MUST read correctly (checked by hand, recorded in the slice's PR).

## Testing

- **Unit tests** on recorded server answers with made-up data: discovery from a domain, a full address and a redirect; task lists vs event-only calendars; every status and priority; a due date with a time zone, without one, and date-only; `RRULE`; `RELATED-TO`; `X-APPLE-*` fields left by Apple Reminders; a task moved between lists; 401, 404 and a server that does not answer; the address rules of FR-003.
- **A local CalDAV stand**, used only by the tests and never shipped: Radicale for the automatic integration test, Nextcloud with the Tasks app for the checks by hand. A seed script puts made-up tasks into both.
- **By hand on Nextcloud**: tasks created and changed in Thunderbird, Apple Reminders (through an iOS or macOS CalDAV account) and the Nextcloud web app show and refresh on a board (FR-011). iCloud and Fastmail are checked in slice 2.
- `make check` and `make smoke` green; the mock tracker stays the default, so the stack runs without any CalDAV server.
- **Preview**: after slice 1 a release candidate goes to the person who asked in discussion #71, before the release.

## Slices

1. `caldav-connect`: FR-001 – FR-011 on Nextcloud and Radicale. Adapter, connection in Settings with the list switches, the CalDAV tab in the card tool, refresh, the guide page, `THIRD_PARTY.md` and CHANGELOG.
2. `caldav-more-servers`: iCloud and Fastmail checked and their setup in the guide; whatever the preview of slice 1 turns up.

## Out of scope

- Calendar events (VEVENT) as cards.
- Writing back: ticking a task done, editing it, creating a task from tiko.
- Several CalDAV accounts per person.
- Pasting a link to a task (a Nextcloud Tasks link, for example) into the card tool.
- Google Tasks, Microsoft To Do and other trackers without CalDAV.
- Expanding a repeating task into its occurrences.
