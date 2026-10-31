# Cassette Label Studio

A specialised design studio for cassette labels. You supply the artist identity, visual references and tracklists; a **local, rule-based design engine**
suggests directions; a **deterministic vector engine** guarantees exact physical output on top of your original vendor templates.

**Everything runs on your computer. There is no API key, no account, no paid service and no internet connection required.**
(An internet connection is only needed once, to `npm install`.)

React + TypeScript front end, a small local Express server (PDF export, font embedding, export verification), SVG artwork, PDFKit + svg-to-pdfkit for the PDF.

## Install and run

Requires Node 20+.

```bash
npm install
npm run dev     # web UI on http://localhost:5173, local server on http://localhost:8787
```

Other scripts: `npm test`, `npm run typecheck`, `npm run build` then `npm start` (UI and server on one port, 8787), `npm run validate-pdf -- file.pdf --template <id> --mode single|sheet|desktop`.
No configuration files or environment variables are needed.

## The workflow

1. **Choose a template**: the library of your original vendor outlines (geometry is locked after selection).
2. **Release and references**: album, artist, catalogue number; upload the **artist logo**, a **typography reference / font logo**, the **album artwork** and **style references**.
3. **Tracklists** for Side A and Side B (`Song | 3:45`).
4. **Automatic design suggestions**: pick a preset, or let the built-in rules suggest one direction or three variations from your references.
5. **Typography**, **artwork/colour** and **layout** controls; edit directly in the preview.
6. **Print proof & export**: PDF (desktop sheet, individual 1-up pages, or the original 12-up sheet) or SVG.

Everything is **undoable** (Ctrl+Z / Ctrl+Y or the header buttons). A drag or resize is one undo step; typing and sliders coalesce.

## Automatic design suggestions (local, rule-based)

`src/core/suggest.ts` is a deterministic rule engine. The same inputs always give the same suggestions. It runs in the browser, with no network and no model.

**What it measures** (`src/core/art.ts`, `src/core/logo.ts`, in your browser, from the pixels): dominant colours; brightness, saturation and **warmth**; **contrast**; how **busy** the image is; where the **subject** is (up to three focal areas); the logo's contrast, transparency, opaque box and resolution; and the **length of each tracklist** and the title.

**What it does with that:** it applies the explicit design rules of three schools of design:

| School | Rules (palette, type, ornament, Side B) |
| --- | --- |
| **Minimal editorial** | Paper-light background tinted by the artwork's hue, near-black text, one restrained accent; serif title or all-sans lowercase; rules or a keyline frame; Side B matched |
| **Vintage analog underground** | Warm tape-stock paper, deep ink text, warm accent with a complementary secondary; typewriter, retro display or heavy grotesque caps; stripes, dots or a frame; Side B tinted |
| **Experimental contemporary** | Dark field in a hue derived from the artwork, electric accent; condensed or monospaced type; grid, scanlines or hazard stripes; Side B inverted |

Each school has **three alternatives**. "Suggest 3 variations" shows all three side by side with live Side A/B previews on your locked template. "Regenerate this one" rotates that school to its next alternative, chosen so it still differs clearly from the two you keep (a distance measure over typefaces, ornament, layout and palette checks this; every combination of alternatives is tested to differ). "Suggest one from my references" picks the school that matches the measured mood and says why.

Rules adapt to your content: long tracklists get smaller, plainer type; long titles get smaller titles; busy artwork is toned down and gets a backing plate; the crop follows the detected subject; the artwork's subject becomes a keep-out for text; the logo gets a **lighten / darken / remove-background** recommendation from measured contrast. Every suggestion is validated (colours, fonts, ranges), text contrast is at least 4.5:1, it never hides the tracklist, and it is applied as a normal **undoable** edit that can **keep your manual edits**. Suggestions are labelled "Automatic suggestion (rule-based)" in the app and never touch template geometry.

### What a local engine cannot do (compared with an AI art director)

- It does **not understand what an image shows**: it measures colour, light, detail and where the strong subject is, not that something is a face, a city or an instrument. "Focal area" means a high-contrast region, not a recognised subject.
- It does **not read or match lettering** from a typography reference image; typefaces come from the rules and the font library (the typography image is placed, not analysed).
- It cannot take **free-text notes** such as "dreamy, sparse, 1983 Tokyo", and it has no knowledge of the artist's genre, story or the release's meaning.
- Its explanations are **templated from the measurements**, not free-form reasoning, and its creative range is the three schools times three alternatives plus the eight presets. A person (or a model) could invent something outside those.
- Logo and artwork analysis are pixel heuristics: background removal suits uniform backgrounds, and treated logos are raster copies.

You can always fine-tune any suggestion by hand, or start from one of the eight presets.

## Presets (starting points, not templates)

Minimal underground label · Vintage 1980s cassette · 1990s independent record label · Japanese city pop · Experimental electronic · Industrial / techno · Punk / DIY photocopy · Modern editorial typography.
A preset only sets palette, fonts, case, tracking, sizes, ornament and the Side B treatment. Your text, assets, template, export settings and manual positions are never touched, and every value stays editable.

## One release, two sides

Both sides share one design language (palette, fonts, ornament, header structure). **Side B** can be *matched*, *inverted* or *tinted*, and each side can have **its own artwork, crop, opacity, background colour, logo and typography**. The planner lays out both sides **together**: same header structure and, when the typography matches, the same text size.

## Tracklist composition (planner)

`src/core/plan.ts` derives free regions from the source's own safety guides around the window or hubs and searches arrangements for **both sides together**:

- tracks keep reading order and are split into **contiguous, balanced groups**; no stray single track, and a list is **not split around the window** when it can sit in one band
- the header (logo, wordmark, title, artist, catalogue) goes first; a logo that cannot share a column with the titles gets its own column; the side heading goes above the tracks, or into the header / catalogue line only if nothing else fits
- **readability first**: the header shrinks before the tracks (down to 70%), tracks never go below your legibility limit (default 5 pt), and the artwork **focal areas** are avoided
- if it still cannot fit at a readable size, the overflow is drawn, outlined in red and reported, **never dropped and never made unreadable**. Focal areas are a soft preference and are relaxed (with a warning) before overflowing
- warnings for text that is small, overlaps the artwork/window, leaves the safety guides, has low contrast, or overlaps other text

Layout modes: **Automatic**, **Side A / Side B separated** (big side letter), **Minimal** (logo and release info, tracks intentionally not printed and stated), **Manual**. The result is cached by what affects layout, so dragging stays fast.

## Typography

- **Heading and body fonts** chosen separately (font pairing), **weight**, **case**, **letter-spacing**, **line height**, **alignment**, sizes; **independent settings for Side A and Side B**.
- **Studio fonts** bundled in `public/fonts` (OFL / Apache; see `public/fonts/LICENSES.md`): Bebas Neue, Space Mono (regular + bold), DM Serif Display, Archivo Black, Righteous, Special Elite. They work offline.
- **Upload your own TTF/OTF** (regular and bold faces separately with the same family name). Only upload fonts you are licensed to use.
- **Embedding in the PDF**: studio fonts and uploaded fonts are embedded as subsets (searchable text). An uploaded font is embedded **only if its own OS/2 `fsType` permits it**; the server re-reads those bits from the font bytes and never trusts the client. Helvetica, Times and Courier are standard PDF fonts and are not embedded. A standalone SVG carries its fonts as `@font-face` rules.

## Manual editing

Click an element in a preview to select it; the first drag switches to manual layout **seeded from the exact composition on screen**. Drag, resize, nudge with the arrow keys (0.1 mm, Shift 1 mm), **lock** elements, reset one to its automatic position. Track groups are separate draggable blocks and follow tracklist edits. Per side: artwork **opacity**, **crop** (the artwork always covers the frame, never distorted), **focal areas**, background colour, optional text backing plate. **Every element stays inside the template's safe area** (drags are clamped and positions are clamped again when rendering).

## Logo handling

Each side's logo is checked against **that side's actual background**: dark on dark, light on light, poor contrast, an **opaque background box**, **low resolution** at the printed size (below 200 dpi warns, below 300 dpi advises), blank images. Fixes (light or dark copy, background removal) create **separate copies**; the original upload is never modified, and each side can use a different logo asset.

## Ornaments

Frame, rules, edge stripes, grid, dots, scanlines: deterministic vector decorations drawn **inside the clipped artwork group**, so they can never pass the source bleed frame or the cutouts. Stripes live only in the margin outside the text area (skipped when there is none); patterns stay faint.

## Template geometry (unchanged)

`scripts/extract_templates.py` copies the original vector paths from your PDFs to millimetres (`src/templates/library.json`, `template_inventory.json`). Nothing is redrawn or scaled. After you choose a template its cut path, bleed frame, safety guides, inner shapes and original 12-up slot positions cannot be edited. Artwork is clipped to the **source bleed frame**.

| Template | Cut path (mm) | Inner shape behaviour | 12-up |
| --- | --- | --- | --- |
| CL-NW | 90.000 × 41.152, square corners | two Ø14.5 hub circles kept as cut paths | yes |
| CL-SQ | 88.556 × 40.248 | oval 61.351 × 15.670, cutout | yes |
| CL-WIDE | 94.912 × 40.912 | oval 58.609 × 15.870, cutout | yes |
| CL4RC Standard 2024 | 88.900 × 40.919 | oval 60.325 × 15.875, artwork-covered | yes |
| Round bottom 2021 | 88.905 × 41.451 | oval 60.333 × 15.557, artwork-covered | no |
| Cassette label 2017 | 88.905 × 41.451 | oval, behaviour not specified in the source | yes |
| CL4RC Gloss | not extractable (raster-only source), listed as UNVERIFIED and not usable | | |

## Print proof, export and verification

**Print proof & export** shows Side A and Side B with the cut, bleed and safety lines, the **actual physical dimensions**, **font embedding status**, layout checks (all tracks placed, nothing clipped, no text on text), print instructions and a prominent **"Do not use Fit to page"** warning. Export is blocked on real errors and until you acknowledge printing at 100%.

Exports are always 1:1 and never scaled: desktop sheet on A4 / US Letter with a 10 mm calibration square; individual labels at the vendor's 1-up size; the **original 12-up Letter sheet**; optional calibration page; PDF and SVG.

Every PDF is **verified after it is generated**, on the real file (`server/validate.ts`): page sizes; each cut path at its exact size and position (all 12 slots on a sheet) to 0.01 mm; the artwork filling the bleed frame; the 10 mm square; embedded fonts; **every character** of text; every track; no clipped text. `npm run validate-pdf` checks any PDF from the command line.

## Print testing

`docs/PRINT_TESTING.md` explains how to print at 100%, measure the calibration square, cut, compare the label with the cassette and record any discrepancy (`docs/fit-record-template.md` / `.csv`). It defines three levels (file-verified, print-verified, fit-verified); only the last means a label fits a cassette.

## Verification status

| Area | Status |
| --- | --- |
| The PDF file: sizes, cut paths, positions, 12-up slots, calibration square, fonts, text, tracks | **Verified automatically** on every export and in the test suite |
| The suggestion engine | **Tested** on synthetic images and on all templates; it is a rule engine, so its taste is limited to its rules (see above) |
| **Physical fit of a printed label on a real cassette shell** | **NOT VERIFIED.** Nothing has been printed and tried on a shell. See `docs/PRINT_TESTING.md` |

## Tests

`npm test` runs 400+ tests. The physical-accuracy tests (library geometry, PDF page sizes, cut paths, 12-up slots, calibration square) are unchanged and pass.

- `library`, `pdf-export`, `render`: original template geometry, exact PDF dimensions, rendering
- `suggest.test.ts`: image features, every school and alternative (valid, readable, available fonts), distinctness for every combination, determinism, regeneration, adaptation to content, logo advice, all alternatives on all six templates, and **guards that no source file references an AI vendor, key or external URL**
- `presets`, `planner`, `typography`, `editing`, `logo-art`, `direction`, `validation`, `docs`, `server`: presets, tracklist planning, fonts and embedding, undo/redo and manual editing, logo and focal analysis, direction validation and application, the export validator and print proof, documentation honesty, the local HTTP API (also tested with no environment configuration)

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/core/suggest.ts` | The rule-based suggestion engine (pure, offline) |
| `src/core/art.ts`, `src/core/logo.ts`, `src/core/color.ts` | Image features and focal detection, logo analysis and treatments, colour tools |
| `src/core/direction.ts`, `src/core/presets.ts` | Direction validation/application, distance measure; presets |
| `src/core/templates.ts`, `src/templates/` | Locked template geometry and the extracted library |
| `src/core/plan.ts`, `src/core/blocks.ts`, `src/core/render.ts` | Composition planner, text/image blocks, label SVG, manual layout, warnings |
| `src/core/model.ts`, `src/core/style.ts`, `src/core/history.ts`, `src/core/ornaments.ts` | Design model, per-side style, undo/redo, ornaments |
| `src/core/fonts.ts`, `src/core/fontcss.ts` | Font families, licence parsing, SVG font embedding |
| `src/core/page.ts`, `src/core/proof.ts` | Export composition; print proof and export expectation |
| `server/pdf.ts`, `server/fonts.ts`, `server/validate.ts`, `server/pdfinspect.ts`, `server/index.ts` | PDF export with font embedding, export verification, local HTTP API |
| `src/ui/*` | Template library, editor, previews, suggestion dialog, print proof |

## Known limitations

- **Physical fit has not been verified** (see above).
- The suggestion engine is a **rule engine, not an AI**; see "What a local engine cannot do". Suggestions are good starting points, not finished art direction.
- Font upload accepts **TTF/OTF** only (no WOFF or `.ttc`). Embedding was verified for TrueType-outline fonts; CFF-outline OpenType is accepted but not covered by a test.
- Text regions are rectangles from the **bounding boxes of the source safety guides**; rounded corners of the round-bottom template are not modelled separately. Narrow side panes (< 22 mm) are not used for track text.
- The planner is heuristic; on the smallest regions it trades a few points of type size (never below your legibility limit) for a tidy single-band tracklist, and may merge the side heading into the catalogue line.
- Manual mode supports up to four track groups per side. Undoing the very first template choice returns to the template library.
- 12-up sheets have no room for a calibration square, so it goes on the appended page.
- Output is RGB; CMYK and spot colours are not implemented. Uploaded images (including SVG) are rasterised.
- The glyph-count check relies on how PDFKit writes SVG text (one operation per character); it verifies this app's own pipeline, not arbitrary PDFs.
- Preview text widths come from the browser and the PDF from PDFKit metrics (metric-compatible); check the PDF before a print run.
