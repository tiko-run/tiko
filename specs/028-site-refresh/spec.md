# Feature Specification: Landing refresh and the Cloud waitlist

**Feature Branch**: `028-site-refresh`

**Created**: 2026-10-17

**Status**: Owner agreed the scope and the wording on 2026-10-17; built in one slice, shown at G3 on the Pages preview.

**Input**: Owner, 2026-10-17: "A lot has changed since the last time, take it into account. Change 'No tracking' and 'Reads your tracker, never edits it'. Make the page wider and the text larger, like linear.app. An installer switch for Windows, Linux and Mac in the hero. A neat badge in the hero that Cloud is coming, with an e-mail form instead of a link: we tell you when it opens, and the free plan comes first."

## Why

The landing was written before Planning mode. Two of its promises read wrong: "No tracking" next to a daily usage ping, and "never edits it", a promise the landing does not need to make. The page is narrow for a wide screen, its small text is hard to read, Windows visitors see a Unix command first, and a person who wants the hosted version has no way to hear when it opens.

## Decisions

1. **Wider and larger.** The page grows to about 1340 px; the root size goes to 17 px so text, controls and spacing grow together; headings reach 64 and 48 px as on linear.app. The drawings inside the feature tiles keep their pixel sizes.
2. **Wording.** "Your tracker stays the source of truth" replaces "Reads your tracker, never edits it"; "No ads, no analytics trackers" and "Anonymous counts only" replace "No tracking".
3. **One install command for the visitor's system.** Windows gets the PowerShell line, everyone else the shell script; no tabs (owner, 2026-10-17). Without JavaScript the shell script shows. The self-hosting block keeps both.
4. **Planning gets one line in the Gantt tile**, not a section of its own: a whole block for one feature stood out (owner, 2026-10-17).
5. **Waitlist.** One field for an e-mail address in the hero badge and in the self-hosting block. The address goes to the existing collector Worker (`t.tiko.run/v1/waitlist`), checked by Cloudflare Turnstile, and lands in its own table in the same EU database. The Worker can only insert into it, never read it back. No confirmation e-mail now: one e-mail is sent when Cloud opens. A checkbox, off by default, asks for news too. Anyone can type any address, so the tick is only a request: the launch e-mail asks the owner of the mailbox to confirm news, and every later e-mail has an unsubscribe link. A repeat sign-up keeps the first row. Corners are 8 px like the rest of the site.
6. **Privacy page.** `tiko.run/privacy/` says what the form keeps (the address, the time, the form, the news tick), where (EU), why (the launch e-mail; news only after it is confirmed there), how long (deleted after the launch e-mail unless news was confirmed) and how to be removed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A visitor leaves an e-mail for Cloud (Priority: P1) 🎯

**Independent Test**: on the preview, submit an address from the hero and from the self-hosting block; the row is in the `waitlist` table; the same address again is accepted without a second row.

**Acceptance Scenarios**:

1. **Given** the hero, **Then** a badge above the headline says tiko Cloud is coming with a free plan first; **When** clicked, **Then** it turns into an e-mail field with a button in place.
2. **Given** a valid address and a passed Turnstile check, **When** sent, **Then** the form says the person will hear once when Cloud opens.
3. **Given** a bad address, **Then** the Worker answers 400; a failed check, 403; a body over the limit, 413; and it stores nothing.
4. **Given** the form, **Then** a line under it links to `/privacy/`.

### User Story 2 - The page reads as tiko today (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the page, **Then** no text says "never edits" or "No tracking".
2. **Given** the features, **Then** the Gantt tile names Planning mode.
3. **Given** a 1440×900 screen, **Then** the content is about 1340 px wide and body text is at least 17 px.

### User Story 3 - A Windows visitor copies the right command (Priority: P2)

**Acceptance Scenarios**:

1. **Given** Windows, **When** the page loads, **Then** the hero shows the PowerShell command and its copy button copies it.
2. **Given** JavaScript is off, **Then** the Unix command shows.
