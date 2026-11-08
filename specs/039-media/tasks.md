# Tasks: Images, GIFs and stickers on the board

## Slice 1: images

- [x] T001 `FileStore` port and its Postgres adapter: `files` table per workspace (RLS like the other tables), SHA-256 dedupe, uploader, size, picture size, average colour; the WebP copies kept beside the original
- [x] T002 Upload `POST` with type, size, pixel and quota checks; EXIF orientation applied and metadata stripped; copies at 512 / 1024 / 2048 (Pillow, licence checked, `THIRD_PARTY.md`); nginx body limit raised for this route only
- [x] T003 Serving: by board (view access) and by public link; year-long cache; tests for access across workspaces and a revoked public link
- [x] T004 `image` element in the board document (file id, size, rotation); older boards read unchanged
- [x] T005 Image node: reserved size and average colour, copy picked by size × zoom × pixel density, async decode, rotation and resize like a sticky
- [x] T006 Paste, drop, the Image tool (`I`) and Add image in the right-click menu: instant local preview, background upload, placeholder for others, error with retry per image
- [x] T007 Measure PNG copies (lossless vs high-quality WebP) on real screenshots; measure FR-007 and write the numbers into the PR
- [x] T008 `TIKO_FILES_QUOTA_MB` in `.env.example` and the guide; demo quota
- [x] T009 Guide (Images page, shortcuts), CHANGELOG

## Slice 2: gifs

- [x] T010 Animated WebP and first frame made at upload
- [x] T011 Animate only in view and at least 160 px wide on screen; reduced motion; the 50-GIF measurement
- [x] T014 An element whose upload never finished says so after a while instead of "Uploading…"; anyone who can edit can pick the file again (FR-010)
- [x] T015 Resizing a turned picture keeps its proportions (FR-011)
- [x] T016 The board keeps the server's average colour after the upload (FR-013)
- [x] T017 Measure FR-007 and FR-008 again with the CPU slowed four times (FR-014)
- [x] T020 Serve a file through a board only when the board refers to it, counting elements not saved yet; a still local preview for a GIF while it uploads (FR-016)
- [x] T019 Step down to a smaller copy when a picture needs four times fewer pixels; measure 20 stretched 4K pictures for frames and memory, compared with Miro on the same pictures (FR-015)

## Slice 3: stickers

- [x] T012 Noto Animated Emoji as xz-packed Lottie in the repository, drawn to WebP by the server on request and cached in `data/stickers/`, outside the database and the quota; `THIRD_PARTY.md` and the guide credit it
- [x] T013 Sticker panel: built-in set, workspace pack, "Save to stickers" on an image; smoothness with the CPU slowed four times
- [x] T022 An animated WebP keeps its frame timing and, up to 1024 px wide, plays as it is without a second copy; a transparent picture shows no tone behind it once loaded; moving pictures play from 80 px on screen

## Slice 4: files-cleanup

- [ ] T018 Remove files no element refers to, some time after their last element is gone; the quota counts what is left (FR-012)
- [ ] T021 A request budget for pictures served through a public link (FR-017)
