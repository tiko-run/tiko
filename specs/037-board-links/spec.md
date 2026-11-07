# Feature Specification: Board links

**Feature Branch**: one `feat/<slice>` per phase, see [tasks.md](tasks.md)

**Created**: 2026-11-07

**Status**: Approved by the owner at G2 on 2026-11-07.

**Input**: A team ran a retro on a self-hosted tiko and got lost between links. The server logs were clean; the access model held. The friction was in the app: the only link Share lets you copy is the public one, a signed-in teammate opened by that link gets the guest view, a board link without access drops people on Home, and the count of people on the board kept jumping.

## Why

- Share shows a Copy button only next to the public link. An owner who wants teammates on the board copies that one, because there is nothing else to copy.
- A public link always opens the guest view, even for a signed-in person who can edit the board. Its "Sign in" goes to Home, not to the board.
- A board link opened by someone who has no access yet (the owner shares it a minute later) drops them on Home with a short toast. They try again, and again.
- An invite opened a second time, by someone who already joined through it, says "This invite link has expired" to a person who is signed in and fine.
- A teammate whose board tab sits in the background drops out of the faces in the top bar and comes back every minute. The browser wakes background timers once a minute; the socket client gives up after 30 s of silence, and others drop a person whose presence is 30 s old.

## Decisions

1. **A public link opens the board for those who can.** When a signed-in person opens `/p/{token}` and can open that board, the page replaces itself with the board, with their own role. Someone who cannot open it keeps the guest view. The public page's "Sign in" signs in right there and checks again, so after signing in a person with access lands on the board, not on Home. A signed-in person without access sees no "Sign in" button.
2. **Copy board link in Share.** The Share dialog gets "Copy link" at the top for everyone who can open it: the board's own address, `/?board={id}`. The public link keeps its own Copy below, with the note that it is for people without an account.
3. **No access is a screen, not a bounce.** A board address the person cannot open shows a screen in place of the board: "You don't have access to this board", with "Ask the person who sent the link to add you in Share" and a button to the person's boards. It does not say whether the board exists. A board that was open and lost its access keeps today's toast and goes Home.
4. **A used invite lets a signed-in person in.** A signed-in person who opens an invite that has been used or has expired goes to their boards without an error. A signed-out person still sees the message.
5. **Presence stays put in a background tab.** The server sends a small message on every board socket at least every 15 s, so a client never sees 30 s of silence. A person drops out of the top bar faces only after 90 s without presence, not 30 s. When a tab comes back to the front it sends its presence at once.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A public link opens the board for a teammate (Priority: P1) 🎯

An owner shares the public link in a team chat. A teammate who has Can edit opens it and lands on the board, able to edit.

**Independent Test**: on the compose stack make a board public and add a second account with Can edit. Signed in as that account, open `/p/{token}`: the board opens with editing. Sign out, open the link: the guest view. Click Sign in, sign in as that account: the board opens. Sign in as a third account without access: the guest view, no Sign in button.

**Acceptance Scenarios**:

1. **Given** a signed-in person with access, **When** they open the public link, **Then** the address becomes `/?board={id}` and the board opens with their role.
2. **Given** a signed-in person without access, **Then** the guest view shows and the API answers the board lookup as for an unknown token.
3. **Given** a signed-out person on the public page, **When** they sign in from it, **Then** the page checks again and opens the board if they have access.
4. **Given** the public link turned off, **Then** the lookup answers 404 for everyone.

### User Story 2 - Copy the board's own link (Priority: P1)

An owner opens Share, clicks Copy link at the top and pastes it into the team chat.

**Independent Test**: open Share as owner and as a viewer: both see Copy link; the copied text is the board's address and opens the board for a member.

**Acceptance Scenarios**:

1. **Given** Share open by anyone who can open it, **Then** Copy link is at the top and copies `/?board={id}` with the instance's address.
2. **Given** a public board, **Then** the public link row says it is for people without an account.

### User Story 3 - No access says so (Priority: P1)

A teammate opens a board link before the owner adds them and sees why they cannot get in.

**Independent Test**: open `/?board={id}` as an account without access: the no-access screen shows; the owner adds the account; reload: the board opens.

**Acceptance Scenarios**:

1. **Given** a board the person cannot open, or one that does not exist, **Then** the same no-access screen shows and the address stays.
2. **Given** a board that was open and lost its access, **Then** the toast and the move Home stay as today.

### User Story 4 - A used invite does not scare a signed-in person (Priority: P3)

Someone who joined yesterday clicks the invite in the chat again and lands on their boards.

**Independent Test**: accept an invite, open it again signed in: the boards show, no error. Sign out, open it: the expired message shows.

### User Story 5 - Faces stay put (Priority: P2)

A team of eight sits on a retro board; some tabs are in the background. The faces in the top bar do not change while nobody comes or goes.

**Independent Test**: two browsers on one board, one tab hidden for 5 minutes (Chrome intensive throttling, or a test that holds timers to once a minute): the socket does not reconnect and the other browser keeps the face.

**Acceptance Scenarios**:

1. **Given** a tab hidden for 5 minutes, **Then** its socket stays open and the other people keep seeing its face.
2. **Given** a person who closes the tab, **Then** their face goes within 90 s; a socket close removes it at once, as today.
3. **Given** a hidden tab shown again, **Then** its presence reaches others at once.

## Requirements *(mandatory)*

- **FR-001**: A signed-in person who can open a board MUST reach it from its public link; anyone else MUST get the guest view, and the lookup MUST NOT tell them apart from an unknown token.
- **FR-002**: Share MUST offer the board's own link to everyone who can open the dialog.
- **FR-003**: A board address without access MUST show a screen that says so and does not tell whether the board exists.
- **FR-004**: A signed-in person MUST NOT see an error for a used or expired invite.
- **FR-005**: A board socket MUST NOT stay silent for 30 s, and a person MUST stay in the faces for 90 s without presence.
- **FR-006**: The API contract MAY gain one route, `GET /api/boards/by-public/{token}`. The board document MUST NOT change; the live protocol gains only the server's keepalive, a message the current client already accepts.

## Success Criteria

- **SC-001**: A signed-in member opening a public link reaches an editable board in one page load, checked on the compose stack.
- **SC-002**: A quiet room sends something to every socket at least every 15 s, so a tab that wakes once a minute never sees 30 s of silence and makes no reconnects; checked by a backend test of a room where nobody acts.

## Out of scope

- Inviting a new person to a board. Registration stays with the admin in Settings → People.
- Asking the owner for access from the no-access screen.
- Changing roles, Everyone in this workspace, or how public links work for guests.
