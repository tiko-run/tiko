# Feature Specification: Images, GIFs and stickers on the board

**Status**: Approved at G1 and G2 on 2026-11-08.

**Input**: Early users cannot put a picture on a board. They want to paste a screenshot, drop a file, add a GIF, and put stickers on things, as in Miro and Telegram. The owner's condition: the canvas must stay as fast as it is now.

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
   - Stickers: a panel of stickers (slice 3).
   An image shows the moment it is added, from the local copy, and uploads in the background; other people on the board see a placeholder of the right size until it is stored. A failed upload says so on the element and offers a retry; the other images of the same paste are not affected.
5. **Big images do not slow the canvas.** The original is kept for opening and downloading in full. The board shows a smaller WebP copy made at upload: 512, 1024 and 2048 px wide, only those smaller than the original. The canvas picks the copy by the element's size on screen, the zoom and the screen's pixel density, so a 4K screenshot zoomed out costs as much as a thumbnail. The element knows its size before the picture arrives, so nothing jumps; until then it shows a flat tone of the picture's average colour. Pictures are decoded off the main thread. Double-click opens the original in full.
6. **Text in screenshots stays sharp.** The copies of a PNG keep text readable; the encoding (lossless or high-quality WebP) is chosen by measuring weight and readability on real screenshots during the slice.
7. **Formats and limits.**
   - Accepted: PNG, JPEG, WebP, GIF. Refused with a clear message: SVG (it can carry scripts), HEIC and everything else.
   - Up to 25 MB and 50 megapixels per file; a bigger one is refused before upload when the browser can tell, and by the server in any case.
   - Location and camera data (EXIF) are removed from everything served; the picture is turned by its EXIF orientation first.
   - A workspace quota is set by `TIKO_FILES_QUOTA_MB`, unset by default on a self-hosted instance. Each demo workspace gets a small fixed quota.
8. **Access follows the board.** A file is served only to someone who can open a board of its workspace, and through a board's public link to anyone who has that link. The address of a file never changes, so the browser caches it for a year and loads it once.
9. **GIFs move without the cost** (slice 2). A GIF is stored as is and also as an animated WebP, which is several times lighter. The canvas animates only the GIFs in view, shows the first frame below a zoom threshold and for people who ask the system for reduced motion. Until slice 2 lands, a GIF is accepted and shows its first frame.
10. **Stickers** (slice 3). A sticker panel holds a built-in set and the workspace's own pack; any image on the board can be saved to the pack and then shows in the panel for everyone in the workspace. The built-in set is chosen by its licence, which must allow an AGPL repository and keep dual licensing open; Telegram packs and open emoji sets are checked before the slice starts. Animated stickers are drawn as animated WebP, not Lottie, under the same rules as GIFs.

## Requirements

- **FR-001**: A board MUST accept an `image` element that refers to a file of its workspace and has position, size and an optional rotation; older boards read unchanged. The live protocol does not change.
- **FR-002**: Paste, drop and the Image tool MUST add images as in Decision 4; an image MUST show at once and upload in the background; a failure MUST be shown on the element with a retry.
- **FR-003**: The server MUST store a file once per workspace by its SHA-256, record who uploaded it, and refuse anything but PNG, JPEG, WebP and GIF, files over 25 MB or 50 megapixels, and uploads past the workspace quota.
- **FR-004**: The server MUST make WebP copies at 512, 1024 and 2048 px (only smaller than the original), know the picture's size and average colour, and serve nothing with EXIF location or camera data.
- **FR-005**: The canvas MUST pick the smallest copy that is sharp at the element's size on screen, zoom and pixel density, MUST reserve the element's size before the picture loads, and MUST open the original on double-click.
- **FR-006**: A file MUST be served only to someone who can open a board of its workspace or holds a public link to such a board, with a cache lifetime of a year.
- **FR-007**: A board with 30 4K screenshots MUST pan and zoom as smoothly as the same board without them (measured in the Chrome performance panel, numbers written into the slice's PR).
- **FR-008** (slice 2): GIFs MUST animate only in view, above the zoom threshold and without reduced motion; a board with 50 GIFs MUST pan and zoom without dropping frames.
- **FR-009** (slice 3): The sticker panel MUST offer a built-in set under an allowed licence and the workspace's own pack.

## Slices

1. `images`: FR-001 – FR-007. Postgres table and port, upload and serving with access, copies, the element, paste / drop / tool, limits, the guide.
2. `gifs`: FR-008. Animated WebP, pausing out of view and when far, reduced motion.
3. `stickers`: FR-009. After the licence check.

## Out of scope

- Pasting an image by its web address (the server fetching a URL invites abuse; the browser hits CORS).
- Video, YouTube, PDF and document readers; HEIC.
- Removing files no board refers to any more (later; an undo can bring an element back).
- Moving a stored image between workspaces: an image element pasted into a board of another workspace shows "Image not available".
- Image editing: crop, filters, annotations.
