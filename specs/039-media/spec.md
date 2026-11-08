# Feature Specification: Images, GIFs and stickers on the board

**Status**: Approved at G1 and G2 on 2026-11-08.

**Input**: Early users cannot put a picture on a board. They want to paste a screenshot, drop a file, add a GIF, and put stickers on things, as in Miro and Telegram. The canvas must stay as fast as it is now.

## Why

- A screenshot of a bug, a mockup or a chart next to the task cards is the most common thing people paste into a whiteboard. In tiko a pasted image is lost.
- Stickers and GIFs make retros and brainstorms livelier.
- Which fog does this clear: the picture of the problem sits next to the task, so nobody has to look for it in a chat.

## Decisions

1. **An image is a board element.** A new element type `image` refers to a stored file by its id and has the usual position, size and rotation. The file's bytes never go into the board document or the live sync: a save or a live update stays small however many images the board has.
2. **Files are stored once per workspace.** A file is kept by its SHA-256 within the workspace: the same screenshot pasted ten times, or a sticker used a hundred times, is one stored file. Files are not shared between workspaces, so nobody can learn by a hash whether another workspace holds a file. A file records who uploaded it, for the quota and for deleting an account; the board does not show it.
3. **Storage sits behind a port.** The first adapter keeps files in a Postgres table, so the backup that already dumps the database every two hours takes them along and a self-hosted instance needs no new volume. A disk or S3 adapter can replace it later without touching the domain.
4. **Four ways to add an image.**
   - Paste: Ctrl/Cmd + V of a screenshot, a copied image or several copied files, at the cursor.
   - Drop: one or several files from the desktop onto the board, where they are dropped.
   - Toolbar: an Image tool (key `I`) opens the file picker and places the image in the middle of the view.
   - Right-click menu: Add image opens the file picker and places the pictures where the menu was opened.
   - Stickers: a panel of stickers (slice 3).
   An image shows the moment it is added, from the local copy, and uploads in the background; other people on the board see a placeholder of the right size until it is stored. A failed upload says so on the element and offers a retry; the other images of the same paste are not affected.
5. **Big images do not slow the canvas.** The original is kept for opening and downloading in full. The board shows a smaller WebP copy made at upload: 512, 1024 and 2048 px wide, only those smaller than the original. The canvas picks the copy by the element's size on screen, the zoom and the screen's pixel density, so a 4K screenshot zoomed out costs as much as a thumbnail. The element knows its size before the picture arrives, so nothing jumps; until then it shows a flat tone of the picture's average colour. Pictures are decoded off the main thread. The original is not opened from the board in slice 1: a viewer inside the board comes later.
6. **Text in screenshots stays sharp.** Copies are WebP at quality 90: on a real retina screenshot of the app the 1024 px copy weighs 14 KB against 31 KB lossless, and small text stays readable (measured in slice 1).
7. **Formats and limits.**
   - Accepted: PNG, JPEG, WebP, GIF. Refused with a clear message: SVG (it can carry scripts), HEIC and everything else.
   - Up to 25 MB and 50 megapixels per file; a bigger one is refused before upload when the browser can tell, and by the server in any case.
   - Location and camera data (EXIF) are removed from everything served; the picture is turned by its EXIF orientation first.
   - A workspace quota is set by `TIKO_FILES_QUOTA_MB`, unset by default on a self-hosted instance. Each demo workspace gets a small fixed quota.
8. **Access follows the board.** A file is served only to someone who can open a board of its workspace, and through a board's public link to anyone who has that link. The address of a file never changes, so the browser caches it for a year and loads it once.
9. **GIFs move without the cost** (slice 2). A GIF is stored as is and also as an animated WebP, which is several times lighter. The canvas animates only the GIFs in view, shows the first frame below a zoom threshold and for people who ask the system for reduced motion. Until slice 2 lands, a GIF is accepted and shows its first frame.
10. **Stickers** (slice 3). A sticker panel holds a built-in set and the workspace's own pack; any image on the board can be saved to the pack and then shows in the panel for everyone in the workspace. The built-in set is chosen by its licence, which must allow an AGPL repository and keep dual licensing open; Telegram packs and open emoji sets are checked before the slice starts. Animated stickers are drawn as animated WebP, not Lottie, under the same rules as GIFs.
   - Checked before slice 3: Telegram sticker packs belong to their artists and no Telegram term allows using them outside Telegram, so none is bundled, and importing a pack through a bot is not built either. The built-in set is Noto Animated Emoji (CC BY 4.0), copied into the repository as WebP, credited in `THIRD_PARTY.md` and in the panel itself.
11. **Loose ends of slice 1** are closed in the next slices:
   - An upload cut short (the tab closed or the network gone before the file was stored) leaves an element that others see as "Uploading…" for ever. Such an element turns into "Upload did not finish" after a while, can be deleted like any element, and the person who added it can pick the file again.
   - Resizing a turned picture does not keep its proportions, while an upright one does. A turned one keeps them too.
   - Files no element refers to any more stay in the database. A job removes them some time after their last element is gone, so an Undo still finds them; the quota counts only what is left.
   - The colour the board shows before a picture loads is worked out in the browser and the server works out its own; the server's is the one kept, so everyone sees the same tone.
   - A loaded sharper copy is kept when the view zooms out, so nothing is fetched twice. Ten 4K pictures stretched across the board and zoomed into all hold their originals, about 33 MB each once decoded, and keep holding them when the view zooms out to show them all. A picture that needs four times fewer pixels than it holds steps down to a smaller copy.
   - Smoothness was measured on a fast machine only. FR-008 and the repeat of FR-007 are measured again with the CPU slowed four times in the browser's performance panel.

## Requirements

- **FR-001**: A board MUST accept an `image` element that refers to a file of its workspace and has position, size and an optional rotation; older boards read unchanged. The live protocol does not change.
- **FR-002**: Paste, drop and the Image tool MUST add images as in Decision 4; an image MUST show at once and upload in the background; a failure MUST be shown on the element with a retry.
- **FR-003**: The server MUST store a file once per workspace by its SHA-256, record who uploaded it, and refuse anything but PNG, JPEG, WebP and GIF, files over 25 MB or 50 megapixels, and uploads past the workspace quota.
- **FR-004**: The server MUST make WebP copies at 512, 1024 and 2048 px (only smaller than the original), know the picture's size and average colour, and serve nothing with EXIF location or camera data.
- **FR-005**: The canvas MUST pick the smallest copy that is sharp at the element's size on screen, zoom and pixel density, and MUST reserve the element's size before the picture loads.
- **FR-006**: A file MUST be served only to someone who can open a board of its workspace or holds a public link to such a board, with a cache lifetime of a year.
- **FR-007**: A board with 30 4K screenshots MUST pan and zoom as smoothly as the same board without them (measured in the Chrome performance panel, numbers written into the slice's PR).
- **FR-008** (slice 2): GIFs MUST animate only in view, above the zoom threshold and without reduced motion; a board with 50 GIFs MUST pan and zoom without dropping frames.
- **FR-009** (slice 3): The sticker panel MUST offer a built-in set under an allowed licence, credited where it is shown, and the workspace's own pack.
- **FR-010** (slice 2): An element whose upload never finished MUST stop showing "Uploading…" after a while and say the upload did not finish; its author MUST be able to pick the file again.
- **FR-011** (slice 2): Resizing a turned picture MUST keep its proportions, as for an upright one.
- **FR-012** (slice 4): A file no element refers to MUST be removed some time after its last element is gone, and the quota MUST count only stored files that are still there.
- **FR-013** (slice 2): The board MUST keep the picture's average colour as the server worked it out.
- **FR-015** (slice 2): A picture MUST step down to a smaller copy when it needs four times fewer pixels than the one it holds; a board of 20 4K pictures stretched far past their size MUST pan and zoom smoothly, with the CPU slowed four times, and the page's memory MUST stay within what the same board holds at its closest zoom.
- **FR-016** (slice 2): A file MUST be served through a board only when that board's elements refer to it, including elements added a moment ago that are not saved yet; a GIF's local preview MUST stay still while it uploads.
- **FR-017** (slice 4): Pictures served through a public link MUST have a request budget of their own, wide enough for a board that loads many pictures at once.
- **FR-014** (slices 2 and 3): Smoothness MUST hold with the CPU slowed four times, on the GIF board of FR-008 and the screenshot board of FR-007.

## Slices

1. `images`: FR-001 – FR-007. Postgres table and port, upload and serving with access, copies, the element, paste / drop / tool, limits, the guide. Done.
2. `gifs`: FR-008, FR-010, FR-011, FR-013, FR-014, FR-015, FR-016. Animated WebP, pausing out of view and when far, reduced motion; the loose ends of slice 1.
3. `stickers`: FR-009, FR-014. Noto Animated Emoji and the workspace pack.
4. `files-cleanup`: FR-012, FR-017. Removing files nothing refers to, so a full quota frees up; a budget for public picture downloads.

## Out of scope

- Pasting an image by its web address (the server fetching a URL invites abuse; the browser hits CORS).
- Video, YouTube, PDF and document readers; HEIC.
- Moving a stored image between workspaces: an image element pasted into a board of another workspace shows "Image not available".
- Image editing: crop, filters, annotations.
