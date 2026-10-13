# tiko brand

The emblem is a dot grid where one dot grew into a card: a calm canvas where only the task stands out. All text in the SVG files is outlined, so they open in Figma or a browser without the fonts installed.

## Files

| Folder | What | Use |
|---|---|---|
| `emblem/` | Mark alone: color, dark, mono black, mono white | Avatars, inline marks, stickers |
| `logo/` | Emblem + wordmark, horizontal and stacked, same four variants | Top of the README (on a transparent background), site header, docs |
| `wordmark/` | `tiko` alone | Where the emblem is already nearby |
| `app-icon/` | White mark on a blue tile: `favicon.svg`, PNG 16, 32, 48, `apple-touch-icon.png` (180), 512, 1024, `producthunt-thumbnail-240.png` | Browser tab, home screen, store and launch thumbnails |
| `button/` | `tiko-cloud-button`: white mark and label on a blue button with a FREE tag; in the SVG the card shrinks to a dot and grows back every 6 s | "Start on tiko Cloud" link in the README and on sites |
| `social/` | `github-social-preview` 1280×640, `producthunt-gallery` 1270×760, `readme-banner` 1280×352 (PNG at 2×), light and dark; `site-share.png` 1280×640, the first screen of tiko.run without its header and buttons | GitHub social preview, Product Hunt gallery, wide headers, the link preview of tiko.run |

Pick `-dark` on dark backgrounds, `-mono-*` for one-color print or overlays on photos.

## Color

| Token | Light | Dark | Role |
|---|---|---|---|
| Brand | `#096ACB` | `#5FA1F3` | The card, app icon tile, links |
| Dot | `#A6ABB3` | `#5A5F66` | Grid dots in the emblem |
| Ink | `#1C1F24` | `#E6E8EA` | Wordmark |
| Canvas | `#F9FAFB` | `#101214` | Backgrounds of covers |

These are the `--primary`, `--foreground` and `--background` tokens from `DESIGN.md` converted to sRGB.

## Type

- Wordmark: IBM Plex Sans SemiBold (600), lowercase, tracking −3%.
- Taglines and covers: IBM Plex Sans 400 and 500; keys and code: JetBrains Mono 600.

Both fonts are under the SIL Open Font License.

## Rules

- Clear space around the emblem: one dot spacing (1/3 of the emblem height) on every side.
- Minimum size: emblem 16 px only as the app icon tile (`favicon.svg`), otherwise 24 px; horizontal logo 80 px wide.
- Don't recolor the card outside the brand blue, don't add gradients or shadows, don't rotate or stretch, don't move dots.
- On a dot grid background the emblem's dots sit on the grid's dots: the grid step is 11/32 of the emblem height.
- The app icon tile and the tiko Cloud button are the only places where the mark sits on a filled shape.

## Regenerate

Run from the repository root after `npm ci` in `frontend/` (the fonts come from there):

```sh
uv run --with fonttools --with brotli --with uharfbuzz --with resvg-py python brand/generate.py .
```

The script outlines text with fontTools and HarfBuzz and renders PNG with resvg. Geometry: 32-unit grid, dots `r 2.4` at 5, 16 and 27, card `x 10.6 y 10.8 w 18.8 h 10.4 rx 2.6`.
