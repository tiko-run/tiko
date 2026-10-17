# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [CalVer](https://calver.org/) `YYYY.M.N`: the year, the month and the release's number in that month, so a same-day hotfix gets the next number. Releases up to 2026.10.8 used the day as the last number. `make release` moves Unreleased into a version section.

## [Unreleased]

### Added

- Planning mode for the Gantt, off by default: an admin turns it on in Settings → Planning, and rows can then be cut into stages such as Discovery, Build or On hold. Stage types are shared by every board.
- People on Gantt stages in Planning mode: one list of people for the whole tiko, added by hand, on the fly from a stage, or picked from the assignees of the Gantt's tasks. Names show after the stage type or under each stage.
- Columns in the Gantt in Planning mode: Priority, Size, Team and fields of your own, typed straight into the cells. An empty cell shows the parent row's value.
- Filters and saved views in the Gantt in Planning mode: filter rows by any field or by person, with inherited values and teams counted through people on stages, and save a set of filters as a view every Gantt can use.
- Time off for people in Planning mode: dates only, added in Settings or on a Time off lane in the Gantt. A stage whose person is away gets a red outline and says who is away.

### Changed

- The guide keeps its header in place and transitions between pages without a full reload.
- Larger text in the guide, from the sidebar to the page body.

### Fixed

- Pages with code blocks no longer jump right after you open them from a page without code.

## [2026.10.21] - 2026-10-15

### Added

- A short product tour on a person's first editable board: adding tasks, search filters, timers, the Gantt chart and the focus timer, each with a small animation. About → Take the tour runs it again.

- Getting started: a short list of things to try next to About. Items tick themselves when you add a card, paste a link, search with a filter, set a timer, open the timer list, put a task on a Gantt chart, start a focus session or connect your tracker. Show me walks you through each one on your board.

## [2026.10.20] - 2026-10-14

### Added

- Usage stats: the installers send one event per install and a running instance sends one ping a day with its version, how it runs, the kinds of trackers in use and the number of people and boards as ranges. No personal data, board contents or addresses. Every field is listed in the guide's [Usage stats](https://docs.tiko.run/privacy/) page; turn them off in Settings → Privacy, with `TIKO_USAGE_STATS=false` or with the installer's `--no-stats` (`-NoStats`).

- Error reports, off by default: an admin turns them on in Settings → Privacy or with `TIKO_ERROR_REPORTS=true`. A report holds the error type, the lines of tiko's code it came through and the version; no error text, request, people or board contents, and the page sends through the tiko server. `TIKO_ERROR_REPORTS_DSN` sends them to your own Sentry.

### Changed

- "No telemetry" in the README, the site and About now reads "No tracking", with a link to what is sent.

## [2026.10.19] - 2026-10-14

### Changed

- About shows the download of a one-click update under "Updating to", instead of a separate card the panel covered, and names the new versions once.
- After a one-click update About offers a **Reload** button as soon as the new version serves the page, instead of reloading by itself once the updater has cleaned up.

### Fixed

- A selected Gantt chart shows one bar: the scale, dates and milestone buttons moved into the selection bar instead of a second bar under it.

## [2026.10.18] - 2026-10-14

### Fixed

- The Windows installer installs Docker Desktop on a new user profile too: it registers winget for the profile instead of stopping with "winget is missing".
- The download bar of a one-click update no longer jumps back: it moves by layers and images instead of bytes, whose total Docker learns only along the way.

## [2026.10.17] - 2026-10-14

### Added

- One-click updates: an admin clicks **Update now** in About, watches the download and the restart, and the page comes back on the new version. tiko copies the database first, goes back to the previous version when the new one does not start, and keeps the disk to two releases and three such copies. The installers ask to turn it on, yes by default; it runs a small `updater` service, the only part of tiko with access to Docker.
- About shows every release you missed and marks security releases, breaking changes and hotfixes. A security release turns the About dot red and shows admins a banner until they upgrade. **Check now** in About asks GitHub at once.
- A bar above the selection, one for any element: pick a fill for several sticky notes and shapes at once, with one Undo for all of them, and see a color on the board before you pick it. A mixed selection can be narrowed to one kind of element. The bar also collapses cards, adds a timer, duplicates and deletes. It replaces the color pickers of the sticky note and the shape.
- Frames take a fill: one of the six colors, shown as a light tint under the elements inside.
- Style beyond color in the selection bar: opacity for sticky notes, shapes, frames and text, a 1, 1.5 or 3px or dashed outline for shapes, and text size and bold.

### Changed

- tiko checks for a new release every 30 minutes instead of every 6 hours, and About refreshes the answer every 5 minutes.
- Saving boards no longer queues behind the disk with several API processes: SQLite stops flushing to disk on every commit. In a load test of 2000 demo visitors on 4 cores, a board save went from 1.8 s on average to 18 ms. A crash of tiko loses nothing; a power cut or a crash of the host may lose the last changes to the database, of boards, settings or accounts alike.

## [2026.10.16] - 2026-10-14

### Added

- Shapes: rectangle, rounded rectangle, ellipse, rhombus, triangle, parallelogram, hexagon and cylinder, for a flowchart next to the tasks. Pick one in the toolbar (`S`), drag to set its size or click to place it, type text, pick a fill. Shapes take arrows, timers and frames like sticky notes, and search finds their text.
- `TIKO_SOCKET_DIR` lets the web container reach the API over Unix sockets in a directory both share, instead of the Docker network: about a tenth less CPU on busy boards in our measurement. Off by default. See "A Unix socket between the containers" in the guide's Configuration page.
- `tiko.run` gets a landing page instead of a redirect to the guide: what tiko is, a board that plays in the first screen, three ways to lay a board out drawn as small boards, the demo and the install command one click away. A shared `tiko.run` link previews with the headline over the board. `tiko.run/install.sh`, `tiko.run/install.ps1` and the old links to guide pages keep working.
- Monitoring: `/metrics` now tells how busy an instance is. Open boards and sockets, live messages and bytes, sockets the server closed, the time to check and save a board, the delay of the event loop, the wait for the database, busy worker threads and, on a demo, visitors against the limit. `TIKO_METRICS_TOKEN` lets Prometheus read them without an account. See "Monitoring" in the guide.
- Monitoring: `tiko_db_held_seconds` tells which kind of work holds the database, as a sum and a count by `kind`.
- `TIKO_DEMO_LIMIT` sets how many demo visitors an instance keeps at once. Empty means 500, as before.
- GitHub private repositories: add your own GitHub token in Settings → My tracker, and issues and pull requests of the private repositories it reads become live cards. Your GitHub cards then refresh at the board's pace on your own request limit. A private task shows in full only to a person whose own token reads it: others on the board see its key with a hint to connect a token, a guest of the public link sees the key only. See "Your own token" in the guide's GitHub Issues page.

- `TIKO_METRICS_PORT` opens a second port for `/metrics`, served by its own thread: Prometheus keeps getting the numbers of an instance that is too overloaded to answer on port 8000. It needs `TIKO_METRICS_TOKEN`. See "Monitoring" in the guide.

- `TIKO_WORKERS` runs several API processes, one core each, so an instance with many busy boards is no longer held to one core. A board is always served by the same process; signing out, role changes and the limits on wrong passwords and public links work across all of them. With several processes each has its own metrics port, counted up from `TIKO_METRICS_PORT`. See "Several processes" in the guide's Configuration page.

### Changed

- An instance with thousands of boards answers as fast as an empty one: the list of your boards no longer reads every board of the instance, and requests that only read no longer wait for the ones that write.
- The socket of a public link moved from `/api/public/{token}/live` to `/api/public/{token}/live/{room}`, with `room` taken from `GET /api/public/{token}`. Reload public boards left open over the upgrade.
- The limits on wrong passwords, demo starts, people searches and requests of a public link are kept in the database, so they survive a restart of the API.

- `/metrics` answers only to admins and to the metrics token. A member or a demo visitor, who could read it before, gets 404.
- A card's node type in the API and in stored boards is `task_card` instead of `jira_card`, now that a card holds a task of any tracker. Boards are rewritten on the first start of the new version, and tiko first copies the database to `data/backups/before-v12-<time>.db`. A board sent to the API with `jira_card` is still accepted. Reload tabs left open over the upgrade.
- After an edit the server checks the elements that changed instead of the whole board. On a board of 1000 elements a check took about 60 ms on a laptop and stalled everyone on the instance for that long; it now takes about 4 ms.
- Pointers, selections and drags of the people on a board reach the others as one message for the whole board, at most 20 times a second, instead of one message per move and person. Ten people moving at once used to mean 200 messages a second for every tab on the board; now it is 20.
- A board with ten or more people on it sends pointers, selections and drags 10 times a second instead of 20, and the web app moves them evenly in between, so they look the same while the server sends half the messages.
- Sockets of live boards are no longer compressed per message. Compressing every pointer frame took up to 15% of the server's core in a load test; a busy board now sends more bytes and the server has more room for people.
- About: "Report a bug or idea" opens the form chooser for a bug, an idea or a question instead of the list of issues.

### Fixed

- Demo: a visitor who only opened their board counted as one who changed it, so they kept their place for a week and a full demo could not give it to a newcomer. Opening a board no longer gives it a new version; such a visitor leaves within the hour and makes room at once when the demo is full.
- An instance no longer stops at about 510 open boards. The web container's nginx kept its stock limit of 1024 connections per worker, and past it every request answered 500. The limit is now 16384.
- An instance on a Linux host no longer stops at about 1000 open boards: the compose files raise the API container's limit of open files from the host's 1024 to 65536. If you run tiko from your own compose file, add `ulimits: nofile: 65536` to the `api` service.
- From source, `docker compose up` brings the containers back after a crash or a reboot of the host, as `compose.release.yml` already did.
- Install guide: a "Lost the password" section says where the first password is kept after each way of installing, with commands for Windows PowerShell next to the ones for Linux and macOS. The guide used to point to the log, which has no password after the one-line installer, and gave Windows a `grep` command that PowerShell does not have.

## [2026.10.15] - 2026-10-11

### Added

- GitHub cards: the mini-card shows the labels as chips in their GitHub colors and the author. A task without a priority no longer shows an empty Priority row.
- Demo mode: `TIKO_DEMO=1` turns an instance into a public demo. "Try the demo" at `/demo` gives anyone a board of their own without an account, with their own task statuses, kept for 7 days after their last visit. Limits hold off abuse: 5 new visitors an hour per address, 500 on the instance, 3 boards each. A visitor who likes it presses "Sign up to keep it" and stays as a regular member with the same boards; an account nobody signs in to for 90 days is deleted. The instance keeps its tracker: visitors work on the demo tasks, and whoever signs up connects their own token and adds real tasks next to the demo cards. Share on such an instance finds a person by their whole username, 20 searches a minute, and has no "Everyone in tiko". See "Running a demo" in the guide.
- `TIKO_BOARD_LIMIT` sets how many boards a person may own, admins aside. Empty means no limit.
- Toasts: the result of an action shows as a toast in the bottom right. Saving your profile, password, token or the task source, deleting a board, sharing it, changing a person's role and revoking a link now say that they worked, and an action the server refuses says why in the same place. Errors of typed input, like a wrong password, stay under their form.
- GitHub Issues: an issue or a pull request of a public repository becomes a live card on any tiko, with no token and no setup. Paste its link on the board, or type the link or `owner/repo#12` into the card tool. The status follows GitHub (Open, Draft, Merged, Closed, Not planned), and an open issue with a label like `planned`, `in progress` or `shipped` shows that label as its status. Without a token cards update every few minutes inside GitHub's limit of 60 requests an hour; `GITHUB_TOKEN` in the environment brings back the board's pace. See "GitHub Issues" in the guide.
- Tracker logos: on a board that mixes trackers every card and Gantt row starts with the logo of its tracker, so you see at a glance where a task comes from. A board with one tracker looks as before. The mini-card and the sync list always show the logo.
- Demo tasks stay live on an instance connected to Jira: the welcome board keeps its titles and statuses next to your Jira cards, and the sync list shows each tracker on its own row. A task now belongs to its tracker, so the same key in two trackers is two tasks.

### Changed

- The card tool is called "Task card" instead of "Jira card" in the toolbar, the context menu, the shortcuts list and the command palette.

### Fixed

- `make up` prints the addresses of the ports set in `.env`, and `scripts/worktree-setup.sh` gives a worktree a stack of its own when its folder is named like another one or its `.env` came from the main checkout.
- A variable left empty in `.env` means its default. An `.env` copied from `.env.example` stopped the start on the empty `TIKO_TRACKER=`.
- "Test connection" checks the Jira address the instance is set to. Only an admin can test another address, so a member cannot make the server call a host of their choice.
- Deploy to Render puts both services into a project named `tiko` with a `production` environment instead of leaving them ungrouped.
- The web container starts as many nginx workers as it has CPUs to use. On Railway it started one per core of the host, 48 of them.

## [2026.10.14] - 2026-10-10

### Added

- Public link: the owner of a board turns on "Anyone with the link can view" in Share, and anyone opens the board without an account, view-only. Tasks from a tracker show a guest only their key, and the board updates live as people change it. Turning the link off stops it for good; an admin can switch public links off in Settings → Sharing. See "Working together" in the guide.
- Live boards: everyone on a shared board sees each other's changes as they happen. Changes to different parts of one element merge; when two people change the same thing at once, the later change wins. Viewers watch live. See "Working together" in the guide.
- Undo and redo go through your own changes only.
- A dropped connection no longer costs work: you keep editing, "Reconnecting…" shows, and changes merge when the connection is back. After 30 seconds offline with unsent changes tiko warns and the browser asks before the tab is closed. Restarting tiko under open boards loses nothing.
- A role change, lost access or an ended session reaches an open board at once and says what happened.
- Presence on shared boards: avatars of the people on the board in the top bar, each person's cursor with their avatar, an outline around what they have selected, elements that move while someone drags them, and other people's changes gliding into place.
- One-command install for Windows 10 and 11: `irm https://tiko.run/install.ps1 | iex` installs WSL 2 and Docker Desktop after asking, with one restart, then starts tiko and opens the browser.
- From source, `TIKO_PORT` and `TIKO_API_PORT` in `.env` move `docker compose up` to other ports, so a second copy runs next to the first.

### Changed

- Dark theme is a soft slate instead of near-black, with lower contrast, after GitHub's dark dimmed palette.
- **Breaking for instances behind their own reverse proxy:** boards are edited over a WebSocket at `/api/boards/<id>/live`. A proxy that does not pass WebSocket upgrades leaves boards view-only; the guide has settings for nginx, Caddy and Traefik under Configuration. `docker compose`, Railway and Render need no changes.
- Reload tabs that were open during the upgrade: a tab still running the old app saves the old way and keeps reloading the board. Pages are now served with `Cache-Control: no-cache`, so a reload always gets the current app.
- The "This board changed in another tab" reload is gone: two tabs or two people no longer overwrite each other.
- Selecting an element no longer brings it to the front: stacking is the same for everyone on the board.
- Pan and zoom are remembered per person in the browser instead of being saved with the board.
- `PUT /api/boards/{id}` keeps working and is applied to the live board, so people who have it open see the change.
- The installers print the address, username and password as a highlighted block.

- The guide at [docs.tiko.run](https://docs.tiko.run) has a new look in tiko's colors and fonts, a start page with links to every section, and a regrouped sidebar. Page addresses did not change.
- The README is shorter. The roadmap, the list of trackers and the architecture overview moved to the guide: [Roadmap](https://docs.tiko.run/roadmap/), [Task trackers](https://docs.tiko.run/trackers/), [Architecture](https://docs.tiko.run/architecture/).

- The guide moved to [docs.tiko.run](https://docs.tiko.run), and the installer is `curl -fsSL https://tiko.run/install.sh | sh`. Old `tiko-run.github.io/tiko` links redirect.

## [2026.10.13] - 2026-10-09

### Added

- One-command install for Linux and macOS: `curl -fsSL https://tiko-run.github.io/tiko/install.sh | sh` checks the machine, installs Docker after asking (Docker Engine on Linux, Colima on macOS), writes `.env` with a generated password and key, and starts the latest release. Running it again upgrades and keeps your data.
- Install guide with step-by-step Docker setup for Windows, macOS and Linux, everyday commands and fixes for common errors.
- `TIKO_PORT` sets the port of `compose.release.yml`; each release attaches its compose file pinned to that version.

## [2026.10.12] - 2026-10-09

### Added

- Deploy to Render button: a private `tiko-api` with a 1 GB disk and a public `tiko-web`, both from the released images, with the password and the encryption key generated on deploy.

### Fixed

- The web image reaches the API by a short host name on platforms whose DNS needs a search domain, such as Render's private network.

## [2026.10.11] - 2026-10-09

### Changed

- The project is now called tiko and lives at [github.com/tiko-run/tiko](https://github.com/tiko-run/tiko). Images move to `ghcr.io/tiko-run/tiko-api` and `ghcr.io/tiko-run/tiko-web`, the guide to [tiko-run.github.io/tiko](https://tiko-run.github.io/tiko/). Environment variables are now `TIKO_PASSWORD`, `TIKO_SECRET_KEY` and `TIKO_TRACKER`; the session cookie is `tiko_session`, so everyone signs in once more. Browser preferences and focus tracks added in the browser start fresh. Boards and settings in `data/app.db` stay as they are.

## [2026.10.10] - 2026-10-08

### Changed

- Sign-in asks for a username and a password. An upgraded instance creates the account `admin` with the instance password it had, so you sign in as `admin` and find every board and the tracker connection as before. After that `TIKO_PASSWORD` and `data/password` are no longer read.
- API: `POST /api/auth/login` takes `{username, password}` and answers `invalid_credentials` instead of `invalid_password`; `GET /api/auth/status` also returns `me`. Sessions are stored on the server, so signing out ends the session for good.

### Added

- Settings → Profile and Security: change your name, username and password, and sign out everywhere. Changing the password signs out your other devices.
- Settings open in a window over the board with sections: Profile, Security, Preferences (theme, paste text as) and, for admins, Task source. Open it from the main menu or with `⌘,`; the section stays in the link (`?settings=security`). On a narrow screen it fills the screen and lists the sections first.
- The main menu shows who is signed in and ends with "Sign out".
- Settings → People for admins: invite people with a one-time link (7 days, no mail needed), make someone admin or member, disable them, or give them a password reset link (24 hours). Open links are listed and can be revoked.
- `python -m app.reset_password <username>` in the api container prints a reset link for a locked-out admin.
- Board sharing: each board has an owner. "Share" in the top bar adds people as editors or viewers, opens the board to everyone in tiko, or hands it to a new owner. Viewers get a "View only" board with no toolbar, and the server refuses their saves. A board you cannot open is not in your list. Admins act as owner on every board and find the others under "All boards". Each new person gets their own welcome board.
- Each person connects their own Jira token in Settings → My tracker, and cards show each person what their own Jira access allows. Task data is fetched and cached per person, so a shared board never shows a task through someone else's token. Without a token a card shows its key and "Connect your Jira token to see this task". An upgraded instance keeps its token as the admin's. Task source (admins) holds the provider, the Jira URL and the refresh interval; moving to another URL asks everyone to enter their token again.
- `TIKO_TRACKER` and `JIRA_BASE_URL` set the tracker at deploy time, so tiko can be handed over with Jira already in place: admins only invite people and everyone adds their own token. Settings → Task source shows them read-only.
- API: `GET /api/boards` returns `{boards, all}`, and every board carries `my_role` and `owner`. New routes: `/api/boards/{id}/members`, `/everyone`, `/transfer`, `/api/people/directory` and `/api/me/tracker`. `PUT /api/settings` is for admins; its `jira.token` becomes the admin's own token, and `jira.token_state` in `GET /api/settings` is the caller's. Tasks gain the state `no_token`.

- A logo: the emblem is a dot grid where one dot grew into a card. The app has a favicon and a home screen icon, the sign-in screen and the About panel show the emblem, and the user guide shows the logo. Logo files, the app icon and social covers for GitHub and Product Hunt are in `brand/`.

## [2026.10.9] - 2026-10-08

### Changed

- Release numbers are now `YYYY.M.N`, counting releases within the month, so a hotfix can ship on the same day. The next release after 2026.10.8 is 2026.10.9; image tags and update checks work as before.

### Added

- Password sign-in: every instance asks for a password before it shows boards or answers the API. Set it with `TIKO_PASSWORD`, or leave it empty and tiko generates one on first start, prints it to the API log and saves it to `data/password`. The Railway template generates it too. A sign-in lasts 30 days; "Sign out" is in Settings. `/metrics` now needs a sign-in as well.
- Deploy on Railway: a one-click template in the README and the quick start guide runs the released images with boards on a volume and a generated encryption key.

### Fixed

- A tab left open across an upgrade no longer goes blank when it opens a board: it reloads once to get the new version.

## [2026.10.8] - 2026-10-08

### Fixed

- The web container no longer loses the API after the API restarts on a new address, as it does on every redeploy on Railway or Render. The API address is now set with `API_UPSTREAM` (default `api:8000`), so the web image runs on hosts without compose networking.
- The keyboard shortcuts list shows the second Redo shortcut as `⌃Y` on macOS and `Ctrl+Y` elsewhere instead of `CTRL Y`.

## [2026.10.7] - 2026-10-07

### Added

- User guide at [tiko-run.github.io/tiko](https://tiko-run.github.io/tiko/): quick start, adding tasks, search, Gantt, timers, keyboard shortcuts and self-hosting. It is written in `docs/guide/` and published on every change to `main`.
- Paste onto the board: `⌘V` over the board turns copied text into a text element at the pointer, or a sticky note if you pick that under "Paste text as" in Settings. When the clipboard holds only task keys or task links, for example the URLs of several open Jira tabs, each one becomes a card, up to 50 in a grid; keys that cannot be added are listed in a short notice. Elements copied in tiko paste as before.
- Long text in a sticky note gets smaller as you type so it always stays inside the note, and grows back when you delete or make the note bigger. A note holds up to 2000 characters: past that, typing and pasting stop and a "no entry" sign flashes over it. Older, longer notes still show in full.
- A fresh install opens on "Welcome to tiko", a sample board with demo task cards in frames, sticky notes on what to try, arrows, a Gantt with a milestone and a dependency, and a timer. Everything on it can be moved, edited or deleted, and once deleted it does not come back. Upgrades keep their boards and get no sample. A board that was never saved opens fitted to the screen.
- Search on the board: press `⌘K` or `⌘F` (`Ctrl+K`, `Ctrl+F` on Windows and Linux) or pick "Search" in the main menu, and type. The palette finds any text on the board: sticky notes, text, frame titles, Jira cards by key, title, status, assignee, type or priority, timer notes, modules, Gantt rows and milestones. Several words narrow the results, matches are highlighted and each row says where it lives. Arrows and Enter, or a click, move the board to the element, select it and flash it. An empty search lists your recent jumps and the board's frames. A query typed in the wrong keyboard layout (Russian or English) still finds what you meant.
- Search previews and highlights: moving through results with the arrow keys moves the board to each one, in the space under the palette, and Esc puts the board back where it was. While you search, matches are ringed on the board and everything else fades. `⌘Enter` or "Select all N" selects every match and fits them in view, ready to collapse, move or delete together.
- Search filters: type `@anna`, `status:review`, `type:bug` or `priority:high` to narrow search to Jira tasks, and start with `#` to find only frames and modules. While you type a filter, the palette suggests the values on the board with task counts; Tab or Enter turns one into a chip. Several values of one field mean any of them, different fields must all match. Backspace in an empty input turns the last chip back into text; values with spaces go in quotes: `@"Anna Lee"`.
- Commands in search: the palette also offers app commands with their shortcuts (add a sticky note, text, frame, timer, Jira card or Gantt, show timers or the focus timer, switch the theme, keyboard shortcuts, settings, new or renamed board) and other boards by name as "Go to board". Start with `>` to list only commands and boards, or open the palette right there with `⌘P` or `⌘⇧P` (`Ctrl` on Windows and Linux) or "Commands" in the main menu; pressing it again in the palette narrows to commands, then closes.
- Timers on the board: a small amber cube that counts down next to the thing you are waiting for. Pick the Timer tool (`R`) and click a card, sticky note, text or module, or right-click one and choose "Add timer"; it attaches beside the element, moves with it and goes away with it. A timer on an empty spot stays on its own. Click the cube to note what you are waiting for and set when it goes off: 15m, 1h 30m, tomorrow 10:00, fri 9:00, 25.10.2026 15:00. When the time comes you get a browser notification and a chime, the cube turns coral, the tab title shows a count, and a note at the top right offers Done, +10 min and +1 hour. Timers that went off while the board was closed are listed when you open it.
- Timer list: a button left of the sync indicator counts the board's running timers, with a coral badge for those that went off; hover it to see the next one. It opens a panel with every timer of the board, grouped as Gone off, Today, Later, Waiting for status and Done. Click a row to move the board to that timer; the panel stays open until Esc or ×. "Timers" in the main menu opens it too.
- Timers can wait for the tracker: on a Jira card, pick "When the status changes" and the timer goes off as soon as the board sees the task leave its current status, with the new status in the notification. While such a timer waits, the board keeps checking the tracker even when its tab is in the background, so the notification comes while you are in the tracker. Clock timers can repeat every day, on weekdays or every week; Done moves a repeating timer to its next time.
- Focus timer: a pomodoro capsule at the top center of the screen. Start 25 minutes of focus with one click; a chime and a browser notification mark the end, then a 5 minute break, and a 15 minute one after every fourth round. The capsule's color shows the state: gray at rest, green warming to raspberry as the focus runs out, blue on pause, lavender on a break; hover its icon for the state and round. The sliders button sets the lengths, rounds, sound, notification and auto start, and skips or resets the cycle. The countdown survives a reload. Hide it from the main menu.
- Background music under the focus timer: seven built-in lofi tracks (CC0, from OpenGameArt) play in a loop from the capsule's player row. Pick a track, set the volume or add your own audio files in the Music tab of the timer settings; your files stay in this browser (IndexedDB) across reloads until you remove them, and are never uploaded. The Music tab shows how much space they take and whether the browser protects them from automatic cleanup, and names any file it could not keep. Music pauses on breaks and comes back with the next focus, unless you turn that off.
- Arrows can point at a spot instead of an element: drag an arrow from a handle and release it over empty space. Its free end shows a dot on hover; drag it to point elsewhere. Deleting the arrow removes its free end too.
- Smart guides: a dragged element snaps to the edges and centers of the others on screen and to an equal gap in a row or column, with dashed alignment lines and gap markers like in Miro. Resizing snaps to the width or height of the others and marks each element of that size. Hold Alt to move or resize freely. The sticky color bar and module controls hide while you drag.
- About button in the bottom left: what tiko is, the running version with a link to its release notes, and links to the source on GitHub, documentation and issues.
- Modules: interactive blocks added from the Modules button in the toolbar (`M`) or the right-click menu. The first one is Gantt: a timeline over days, weeks, months or quarters, with its own name (double-click the header), a line for today, start and end dates, and "+" buttons that add a calendar quarter on either side. Stretch the block to give each day more room.
- Gantt rows: drop a Jira card onto a Gantt to plan it as a bar at the drop date, or use "Add" in the module: a task from the tracker by key, link or JQL, or a plain task that lives only on the board. Bars show the task's live status color, and done tasks are struck through. Drag a bar to move it, drag its ends to change the dates, drag a row's label to reorder it, or drag it out onto the board to turn it back into a card (plain rows become sticky notes). Plan dates stay on the board and are never written to Jira. Drag the border of the task column to show more of the titles.
- Gantt rows form a tree: nest tasks and plain rows under each other up to five levels by dragging a row label right or with the indent buttons, and add a row under any row. A row with children keeps its own dates and always covers its children (a task keeps its key, title and status color): stretch it wider than its children, drag it to move the whole branch, and collapse it. A child that moves past its parent's edge pushes the parent out. A task row opens in the tracker from its own link button, so dragging never opens it by accident. Deleting a parent keeps its children one level up.
- Gantt milestones and dependencies: add a milestone from the module controls, rename it with a double-click and drag it to its date. Drag the dot past a bar's end onto another row to say that row starts after this one; the line follows both bars and turns amber when the second one starts before the first ends. Click a line to remove it; deleting a row removes its lines. Hover a bar to see its exact dates and length; they follow the bar while you drag it or its ends. A milestone shows its date on hover.
- Update notice: when a newer tiko release is out, the About button gets a dot and the panel links to what's new and how to upgrade. The server asks GitHub at most every 6 hours; `UPDATE_CHECK=false` turns it off.

### Changed

- Panels, menus and dialogs scroll with thin scrollbars in the theme's colors instead of the browser's default bars.
- tiko is now licensed under the GNU AGPL v3 (`AGPL-3.0-only`) instead of MIT. Using and self-hosting it stays free; if you modify tiko and offer it over a network, you share your changes under the same license. Contributions need the [CLA](CLA.md), and the name and logo follow [TRADEMARKS.md](TRADEMARKS.md). Releases up to `v2026.10.6` remain available under MIT.
- The Theme item in the main menu has an icon.
- The sync indicator shows only a colored dot and the last sync time: green when every tracker syncs, amber when some fail, red when none do. Click it to see each tracker with its last sync and the reason it fails.

### Fixed

- A plain Gantt row's title opens for editing on a double-click again.
- A selection box no longer picks up a frame or element that was dragged earlier and sits outside the box.
- Syncing resumes on its own on the next tick after the network or VPN comes back, instead of waiting out a backoff of up to five minutes. Only rate limits and Jira server errors slow polling down now.

## [2026.10.6] - 2026-10-06

### Added

- Boards on an infinite canvas: add Jira task cards by key or link, pan, zoom and drag; boards save automatically and reopen as left. Works out of the box with built-in demo tasks.
- Connect Jira Data Center with a personal access token in Settings; the token is encrypted at rest with `TIKO_SECRET_KEY` and never sent back to the browser.
- Card statuses refresh on their own while a board is open (every 30 s by default, configurable), with one batched Jira request per board, an "updated N s ago" indicator, "Refresh all" and automatic backoff when Jira struggles. Closed tasks are struck through.
- Frames, sticky notes, free text and arrows. Drop cards and notes into a frame to group them; moving the frame moves everything inside, and deleting it keeps the contents. Box-select or shift-click to move or delete several items.
- Right-click menu on the canvas: add a Jira card, frame, sticky note or text at the clicked spot, or delete the selection.
- Keyboard shortcuts for tools (V, H, F, N, T, C), copy and paste at the cursor, duplicate and select all; press ? for the full list.
- Add several Jira cards at once: separate keys or links with commas, and they are laid out in a grid. Keys that fail stay in the field with their errors.
- Draw a frame by dragging; a new frame takes in the elements under it.
- Click a card to open a mini-card with assignee, priority, last update and an "Open in Jira" link. Collapse cards to a single line with key and status from the mini-card or, for the whole selection, from the right-click menu; the state is saved with the board.
- Rename or delete the current board from the board menu; deleting asks first.
- Add cards by JQL: type a query such as `project = DEV AND status != Done` into the Jira card input, and up to 50 matching tasks are laid out in a grid. Jira's own error is shown for a broken query.
- JQL suggestions in the Jira card input, from your own Jira: field names (custom fields too), the operators each field allows, values such as statuses and people, then AND, OR or ORDER BY. Tab inserts a suggestion. Before you press Enter, the hint shows how many tasks match or Jira's error.
- Undo and redo on the board: Cmd/Ctrl+Z takes back a move, resize, delete, edit or new element, Cmd/Ctrl+Shift+Z or Ctrl+Y brings it back. A drag is one step; text fields keep their own undo.
- `make backup` saves a timestamped copy of the database to `data/backups/`; `make up` runs it before every rebuild.

### Changed

- Cards are added from the "Jira card" tool in a floating toolbar at the bottom; the card input no longer stays on the canvas.
- Closing a menu or dialog with the mouse no longer leaves a focus ring on the button that opened it.
- The board panel is replaced by a compact top bar: a main menu with Settings and Theme (Light, Dark, System; kept in the browser) and the board name with a menu to switch or create boards. The canvas library label is gone.
- The Jira card input grows with the text and keeps line breaks, so a long or pasted multi-line JQL query stays readable; Shift+Enter starts a new line. Suggestions open above the input, so it no longer jumps while you type.
