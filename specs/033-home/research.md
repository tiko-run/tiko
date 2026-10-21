# Research: the home screen of infinite-canvas products

Date: 2026-10-21. Input for a tiko spec: the screen you land on before opening a board.
Sources are official help centers, product pages and changelogs unless marked *(forum)*.
"Not documented" means the official source does not say. It does not mean the feature is missing.

## 1. Miro — Home dashboard

Sources:
- Home page: https://help.miro.com/hc/en-us/articles/360017571294-Home-page (updated 2026-10-20)
- Spaces: https://help.miro.com/hc/en-us/articles/21040490154898-Spaces
- Create a board: https://help.miro.com/hc/en-us/articles/360017571974-Create-a-Miro-board
- Duplicate: https://help.miro.com/hc/en-us/articles/360017730113-How-to-duplicate-a-board
- Move: https://help.miro.com/hc/en-us/articles/360017730093-How-to-move-a-board
- Restore: https://help.miro.com/hc/en-us/articles/360017572614-How-to-restore-a-deleted-board
- Board info and thumbnail: https://help.miro.com/hc/en-us/articles/22659235132946-Update-your-board-information

**Landing.** "When you access Miro.com without directly accessing a board by URL, you start at Home." Home "surfaces your most relevant content first, like recently opened boards inside your teams and Spaces, and gets you started with a new canvas or template." "Home replaces the Recent page." Home also has a **template strip**: the Spaces article says a board made "from the Home template strip" does not belong to any Space.

**Sidebar.** Search, **Starred**, **Browse** ("search and filter all team content that you can access, not just recent"), **Spaces**, a team/org switcher, and **+ Create** (board, Format, Space, Group, import, templates). When you are inside a board, the same sidebar collapses into a narrow rail.

**List controls.**
- Filter by owner: "owned by anyone", "owned by you", "not owned by you".
- Sort: alphabetical, date created, last opened, last modified.
- View: grid or list.

Each board card has a thumbnail. The owner can change it by picking an icon, uploading an image (cover shown at 420×420 on the dashboard) or selecting an area of the board.

**Search.** Cmd/Ctrl+E. It matches board and Space names and topics within the current team. Enterprise search also covers board text, comments and stickies.

**Organisation.**
- Teams contain Spaces, and Spaces contain sections. A board belongs to at most one Space: you *move* it, and a board can also sit in no Space.
- Spaces have an emoji, a description, an AI "Space Overview" activity feed, sections you reorder by dragging, and their own sharing. "The role and permissions you grant apply to all boards inside the Space."
- Spaces can be grouped into Groups in the Home sidebar.
- You can move several boards into a Space at once ("Move boards here").
- Spaces were relaunched as a public beta from 2026-08-17.

**Creating a board.** "+ Create > Board" opens the new board immediately. "+ Create > Explore templates" opens the template picker with Use template and Preview. The `miro.new` URL also creates a board. A new account gets a board created for it automatically: "My First Board". The Free plan allows 3 active boards.

**Per-board actions** (the `...` on a card): share, rename, move to project/team/Space, duplicate (a dialog asks for the name and whether to keep sharing settings, and adds a "Copy of…" prefix), delete, change thumbnail, board details, download backup, copy link. You star a board with a star icon that shows on hover.

**Trash.** Restore within 90 days, on paid plans only. Free users can restore a board only by opening its old link.

**Complaints (forum).**
- Recent and Starred were scoped to the current organization "for security reasons", so boards seem to vanish: https://community.miro.com/ask-the-community-45/can-not-find-recent-boards-17842
- The 2026 Spaces beta shows a list only, with no grid or thumbnail view, plus AI content: https://community.miro.com/ask-the-community-45/what-happened-to-my-spaces-display-28811
- Users ask for a plain list of all boards with filters: https://community.miro.com/ideas/a-read-only-list-view-of-all-boards-w-filters-and-advanced-search-3723

## 2. Figma / FigJam — file browser

Sources:
- Guide: https://help.figma.com/hc/en-us/articles/14381406380183-Guide-to-the-file-browser
- Tour: https://help.figma.com/hc/en-us/articles/30926159906967
- Star: https://help.figma.com/hc/en-us/articles/360038511513-Star-your-favorite-files-and-folders
- Pin to folder: https://help.figma.com/hc/en-us/articles/360038511713-Pin-files-to-a-folder
- Move: https://help.figma.com/hc/en-us/articles/360038511573-Move-a-file
- Trash: https://help.figma.com/hc/en-us/articles/360047512294-Delete-and-restore-files
- Search: https://help.figma.com/hc/en-us/articles/4422774037271
- Folders: https://help.figma.com/hc/en-us/articles/360038006494-Create-and-manage-folders
- Drafts: https://help.figma.com/hc/en-us/articles/18409526530967
- FigJam templates: https://help.figma.com/hc/en-us/articles/1500004414082-Find-and-use-FigJam-templates

**Landing.** The file browser is "the home page of your account". **Recents** shows "files you've opened, as well as files and folders people have recently shared with you", so recent and shared-with-me are merged into one list. Right-clicking a file there gives "Show in folder".

**Sidebar.**
- Team switcher.
- **Drafts**: private files that are not in a folder yet. Since 2024–2025 each team has its own Drafts.
- **All folders / Browse**.
- **Starred**: personal ("only you can see which items you've favorited"). You can reorder starred items by dragging, and star a file by dragging it into the section.
- **Templates and tools**, **Trash**, **Admin**.

**List controls.** Grid ("Show as grid") or list. Figma removed list view in March 2025 and brought it back after feedback *(forum)*: https://forum.figma.com/report-a-problem-6/list-view-missing-from-new-file-browser-update-38952. Users complain that sort resets to "Last modified" when they switch teams *(forum)*: https://forum.figma.com/share-your-feedback-26/sorting-resets-when-switching-teams-39389

**Search.**
- Cmd/Ctrl+/ focuses the search. Before you type, the preview lists recently opened files.
- Arrow keys and Enter open a result. Esc closes the search.
- The search also matches text inside FigJam stickies.
- Results can be filtered by resource type, location and file type. They sort by relevance, name, last modified or created.

**Organisation.**
- Teams contain folders. Folders were called projects until August 2026, can nest up to 10 levels on paid plans, have a color, and carry their own access rules.
- A file lives in one folder. Moving it changes who can access it: "Everyone in the destination folder".
- You can move several files at once with Cmd-click.
- "Pin to folder" puts square thumbnails at the top of the folder page. Pinned order is fixed.

**Creating a file.** Click "FigJam board" or go to `figjam.new`. A new board opens with a **templates picker**, which can be turned off in Preferences ("Show templates for new files"). The file browser also has a "Templates and tools" gallery with Community and internal tabs, where FigJam templates sit under "Whiteboarding".

**Trash.** Move to trash removes the file for everyone, so the docs suggest leaving a file if you only want it off your own list. From Trash you can restore to the original folder, duplicate to drafts, or delete permanently. You cannot open a file while it is in Trash.

**Complaint (forum).** "I can never find the file I was working on": https://forum.figma.com/suggest-a-feature-11/i-can-never-find-the-file-i-was-working-on-27964

## 3. Excalidraw+ — dashboard

Sources:
- Product page: https://plus.excalidraw.com/plus
- Changelog: https://plus.excalidraw.com/changelog
- "Three for three" blog post (2023-01-04): https://plus.excalidraw.com/blog/year-three
- API: https://plus.excalidraw.com/docs/api

**Landing.** The dashboard shows "your last edited and visited scenes, as well as where people are working right now". From August 2022 you can choose whether you land on the dashboard or in the editor ("choose the first page loaded").

**Organisation.**
- Workspace contains collections, and collections contain scenes. Every scene is in exactly one collection.
- New drawings go to your **private collection**. In the API, scenes created without a collection go to "Main".
- An admin can sort collections.

**Sort.** By last created (the default), last updated, or alphabetical. The choice is per user, synced across devices, and "won't affect what your teammates see".

**Speed.** Cmd/Ctrl+P opens search from almost anywhere and is "especially useful in the editor for quickly switching scenes". Opt/Alt+A creates a drawing. The dashboard has a "Start drawing" button. Changelog 2026-06: "Faster Scene Search … keyboard navigation".

**Trash.** Changelog 2026-03: "A new sidebar and view to manage deleted scenes. You can now restore items to their original collections", with bulk actions and a date for permanent removal.

**Other.** Changelog 2026-03: scene titles and folder changes "sync instantly across your team without refreshing". Templates exist only for slides (a template picker with tags). There is no template gallery for scenes on the dashboard.

**Not documented:** grid vs list, thumbnails, favorites. The public help docs do not cover the dashboard at all.

## 4. tldraw.com — sidebar file list

Sources:
- "What's new" (March 2025): https://tldraw.dev/blog/whats-new-2025
- Issue #9412 (sidebar time groups): https://github.com/tldraw/tldraw/issues/9412
- Issue #9143 (welcome file): https://github.com/tldraw/tldraw/issues/9143

**There is no separate home page.** The app opens a canvas, and the files sit in a left **sidebar**: "Your recent files are shown in the sidebar … synced between devices." A New file button sits at the top. A three-dots menu appears on hover.

**List.** Files are grouped under relative-time headers: "Today", "Yesterday", "This week", "This month", "Older". The sidebar has a search, and #9412 complains that a lone "Older" header reads badly in search results. **Pinned** files go to the top ("pin your favorites to the top").

**Actions.** Rename, delete, download, share. Sharing invites guests as editors or viewers by link, without a login, and switches a file between public and private. You can also publish a snapshot.

**Workspaces (2026).** There is a personal "My files" space plus team workspaces, and files can be moved into a workspace. Empty state: a new workspace gets an ordinary, editable file called "Welcome to your workspace". The canvas content explains how to invite people and move files, "without an onboarding modal". "My files" starts with a blank first file.

## 5. Whimsical

Sources:
- Organize files: https://whimsical.com/learn/faqs/organize-files
- Sidebar update: https://whimsical.com/product-updates/sidebar-improvements-for-project-organization
- Tabbed folders: https://whimsical.com/product-updates/tabbed-folders

- **Navigation.** The sidebar tree is the main way around. You can pin it open, toggle it with Cmd/Ctrl+E, and resize it.
- **Creating.** Use + in the sidebar, the board/folder/template icons, or `whimsical.new`.
- **Sorting.** Drag and drop in the sidebar or a folder, or sort by creator, created or modified date. Grid and list views are both available.
- **Projects.** Project folders group sub-folders by status: Backlog, Active, Closed.
- **Tabbed folders.** An optional tabbed layout, with a switch back to the classic view.
- **Rename and icons.** Click the name of an open file, or right-click a folder and choose Rename. Files and folders can have custom colored icons.
- **Delete.** Single or bulk delete. Deleted items go to Trash, where you can restore them or delete them permanently.
- **Complaint (forum).** "Add My Files back to sidebar": https://community.whimsical.com/t/add-my-files-back-to-sidebar/1313

## 6. Mural

Sources:
- Dashboard lesson: https://learn.mural.co/lessons/get-to-know-the-mural-dashboard
- Archive: https://support.mural.co/s/article/archive-or-unarchive-a-mural
- Delete: https://support.mural.co/en/articles/2113846-delete-a-mural

- **Structure.** Workspace contains rooms (open or private), and rooms contain folders and murals.
- **Dashboard.** "Recently opened murals" shows the 32 most recent. "Favorite murals" sits in the left section. Starred rooms move to the top of their list.
- **Search** covers murals, rooms and templates. Templates and example murals are reached from the dashboard.
- **Archive** hides a mural from the dashboard without deleting it, and a dashboard filter shows archived murals. A deleted mural cannot be restored in the product; you have to go through support *(forum)*: https://community.mural.co/discussion/1311/mural-recycle-bin

## 7. Notion (for comparison)

Source: https://www.notion.com/help/navigate-with-the-sidebar

- **Sidebar sections.** Favorites (appears after your first star), Teamspaces, Shared (appears once you share a page), Private. You can reorder the sections by dragging.
- **Home.** Recents live on the Home tab.
- **Moving pages.** Drag a page onto another page to nest it. Dragging a page into Private removes other people's access.
- **Trash.** Pages stay 30 days and can be searched and viewed there, but not edited until restored.

---

## Synthesis

### The common core (every product has it)

1. **Recent first.** The landing view is a list of recently opened or edited items (Miro Home, Figma Recents, Excalidraw+ dashboard, tldraw sidebar, Mural "Recently opened").
2. **Personal star or pin.** Miro, Figma, tldraw, Mural and Notion all have one, and it is per user. Figma: "only you can see". A star is a shortcut and does not move the board.
3. **One obvious "New" button** that opens the new board **at once**, with no naming dialog. Miro "opens immediately", and `miro.new`, `figjam.new` and `whimsical.new` exist. Naming happens later, inline, in the board's title.
4. **A per-item menu** (`...` or right-click): rename, duplicate, share or copy link, delete. Move appears wherever folders exist.
5. **Name search with a keyboard shortcut**: Miro Cmd+E, Figma Cmd+/, Excalidraw+ Cmd+P, Whimsical Cmd+E for the sidebar.
6. **Deleted boards can be recovered**, through a trash or a restore window: Miro 90 days, Figma until purged, Excalidraw+, Whimsical, Notion 30 days. Mural, which has none, draws complaints.
7. **A board lives in exactly one place.** Moving it changes its access (Figma, Miro Spaces). Many places exist only as stars or shortcuts.

### Differentiators (not core)

- Spaces or folders with their own permissions, nesting, sections and groups (Miro, Figma, Whimsical, Mural).
- Thumbnails and grid view (Miro, Figma). tldraw and Excalidraw+ get by with a text list.
- Template gallery on the home (Miro's template strip, Figma's "Templates and tools"). FigJam instead shows a picker *inside* the new empty board.
- Who is working where right now (Excalidraw+), and an AI activity feed (Miro Space Overview).
- Owner filter (Miro: "owned by you / not owned by you"), plus sort options and grid/list switches.
- Archive as a separate state from delete (Mural).
- A welcome board written as ordinary canvas content instead of an onboarding modal (tldraw #9143, Miro "My First Board").

### What users complain about

- Boards they cannot find: scoping changes in Miro, the Figma Recents order.
- Lost view options: Figma's list view, the Miro Spaces beta showing a list only.
- Sort and filter choices that do not persist (Figma).
- No recovery after delete (Mural).

Lesson: keep the list predictable and complete. Do not hide "everything I can open" behind scoping.

### Recommendation for tiko v1

tiko's case: one workspace per server, a small team, boards owned by a person and shared with members (the `BoardSummary` model already has `name`, `updated_at`, `my_role`, `owner`, `public`), and demo visitors with about 3 boards.

**Build first:**
1. **A Home route** where you land when there is no board URL. If someone still wants to land on their last board, that can come later as a setting, the way Excalidraw+ lets you pick the first page.
2. **One list of every board I can open**, newest `updated_at` first. Each row shows the name, owner, role or shared badge and "edited 2h ago". Use a list, or simple cards with no thumbnails. That is enough for a few dozen boards, and tldraw and Excalidraw+ ship without thumbnails.
3. **Two tabs or filters:** "All" and "Mine" vs "Shared with me" (Miro's ownership filter). This uses data the model already has.
4. **Star, per user, pinned to the top.** This is the one new field. Stars cost little and appear everywhere.
5. **"New board" button.** It creates "Untitled board" and opens it at once; the person renames it inline, as in Miro and FigJam. A `/new` URL is a cheap extra.
6. **Row menu:** Open, Rename, Duplicate, Share (reuse the existing share dialog), Delete with a confirmation. Only the owner sees Delete.
7. **A name filter box** with a shortcut (`/` or Cmd+K) and arrow keys plus Enter to open. It filters a list that is already loaded on the client, so no backend search is needed.
8. **Empty state:** one sentence, a "New board" button, and (if spec 026-onboarding allows) a starter board created on first visit, like Miro "My First Board" and the tldraw welcome file. Demo visitors land on the Home with their ~3 boards already listed.

**Defer:**
- Folders, Spaces and projects. One workspace and a few boards per person do not need them; add them when people ask, and follow the one-board-one-place rule.
- Trash and restore. In v1, a confirmation on delete is enough. Add soft delete with a 30-day restore once boards hold real planning work, since the lack of recovery is a top complaint for Mural.
- Thumbnails and grid view. They cost render work on the server or in the client, and Miro's cover image is a whole feature of its own.
- Template gallery on the home. If templates come, show them inside the new empty board, as FigJam does.
- Sort and view switches, archive, activity and presence, cross-board content search.
