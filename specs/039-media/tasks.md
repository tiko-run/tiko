# Tasks: Images, GIFs and stickers on the board

## Slice 1: images

- [ ] T001 `FileStore` port and its Postgres adapter: `files` table per workspace (RLS like the other tables), SHA-256 dedupe, uploader, size, picture size, average colour; the WebP copies kept beside the original
- [ ] T002 Upload `POST` with type, size, pixel and quota checks; EXIF orientation applied and metadata stripped; copies at 512 / 1024 / 2048 (Pillow, licence checked, `THIRD_PARTY.md`); nginx body limit raised for this route only
- [ ] T003 Serving: by board (view access) and by public link; year-long cache; tests for access across workspaces and a revoked public link
- [ ] T004 `image` element in the board document (file id, size, rotation); older boards read unchanged
- [ ] T005 Image node: reserved size and average colour, copy picked by size × zoom × pixel density, async decode, rotation and resize like a sticky, double-click opens the original
- [ ] T006 Paste, drop and the Image tool (`I`): instant local preview, background upload, placeholder for others, error with retry per image
- [ ] T007 Measure PNG copies (lossless vs high-quality WebP) on real screenshots; measure FR-007 and write the numbers into the PR
- [ ] T008 `TIKO_FILES_QUOTA_MB` in `.env.example` and the guide; demo quota
- [ ] T009 Guide (Images page, shortcuts), CHANGELOG

## Slice 2: gifs

- [ ] T010 Animated WebP and first frame made at upload
- [ ] T011 Animate only in view and above the zoom threshold; reduced motion; the 50-GIF measurement

## Slice 3: stickers

- [ ] T012 Licence decision for the built-in set
- [ ] T013 Sticker panel: built-in set, workspace pack, "Save to stickers" on an image
