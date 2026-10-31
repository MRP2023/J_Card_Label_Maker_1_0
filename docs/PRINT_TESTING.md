# Print testing guide

Cassette Label Studio guarantees that the **PDF** has the exact dimensions of your original template files. It cannot know what your
printer, your sticker stock or your particular cassette shell will do. This guide is how you find out, and how you record it.

> **Status levels. Do not skip ahead.**
>
> | Level | Meaning | How it is established |
> | --- | --- | --- |
> | 1. File-verified | The PDF has the right page sizes, cut paths, positions, fonts and text | Automatic: the app checks every export, and `npm run validate-pdf` checks any PDF independently |
> | 2. Print-verified | Your printer reproduces those sizes (the 10 mm square and 100 mm ruler measure correctly) | You, with a ruler, steps 1 to 3 below |
> | 3. **Fit-verified** | A printed, cut label fits the real cassette shell | You, steps 4 to 6 below, recorded in a fit record |
>
> Only level 3 means "this label fits this cassette". Until you have done it, the correct statement is "the file matches the template; fit on the shell is untested". The app says exactly that on the proof screen.

## What you need

- the printer and the sticker (or plain) paper you will really use, in the paper size shown on the proof (A4 or US Letter)
- a **steel rule** in millimetres, ideally **digital calipers** (0.01 mm)
- a craft knife and cutting mat (or good scissors), and a metal straight edge
- the **actual cassette** (or cassettes) the template is for. Shells differ between makers, so test the one you will release on
- a pencil, a magnifier, and a phone to photograph the result

## Before you print

1. In the app, open **Print proof & export** and fix every red error (text that does not fit, overlapping text, text cut off by a cutout).
2. Read the yellow **"Do not use Fit to page"** banner and tick the acknowledgement.
3. Export the PDF. The app verifies the file automatically and tells you how many checks passed. To check any PDF yourself:
   `npm run validate-pdf -- my-labels.pdf --template cl4rc-standard-2024 --mode single` (see the script header for `sheet` and `desktop`).
4. Choose the export that matches your workflow:
   - **Desktop sheet**: both labels at 1:1 on A4 / Letter with the calibration square on the same page.
   - **Individual labels / 12-up sheet**: the vendor's own formats; a calibration page is appended (keep it ticked).

## Step 1: print at 100% (this is where most size errors come from)

Print the **calibration page first**, on plain paper, with these settings:

- **Scale: 100% / "Actual size".** Turn **off** "Fit to page", "Fit to printable area", "Shrink oversized pages", "Scale to fit paper", "Poster" and "Borderless / full-bleed".
- **Paper size** in the print dialog must equal the paper in the PDF (A4 or Letter). A mismatch makes some drivers rescale silently.
- Where to find it:
  - Adobe Acrobat/Reader: Print, **Page Sizing & Handling: Actual size**.
  - Chrome / Edge PDF viewer: **More settings, Scale: Default** (100%), and no "Fit to page".
  - macOS Preview: **Scale: 100%** (not "Scale to Fit").
  - Printer driver: look for "Fit/Fill/Zoom/Scaling" on the Layout or Paper tab and set it to Off / 100%.
- Print one copy. Do not use "draft", "economy" or any mode that changes paper handling.

## Step 2: measure the calibration square and ruler

Let the sheet dry, then measure with the rule or calipers:

| What | Expected | Measured | Within tolerance? |
| --- | --- | --- | --- |
| 10 mm square, horizontal | 10.00 mm | | ±0.2 mm |
| 10 mm square, vertical | 10.00 mm | | ±0.2 mm |
| 100 mm ruler (0 to 100) | 100.0 mm | | ±0.5 mm |

- **Measure to the outer edge of the line on both sides** the same way each time.
- If the horizontal and vertical values differ (for example 10.0 and 10.2), the printer feeds paper at a different scale along the paper path. Note it; it is common and usually below 0.3%.
- **Out of tolerance?** Re-check Step 1 (scaling), the paper size, and "borderless". A consistent shrink of about 3 to 5% means "Fit to page" was on. Do not print on sticker stock until this passes.
- If one printer will never print within tolerance, use a different printer or have the labels printed professionally from the original vendor 1-up / 12-up export.

## Step 3: print the labels, check the cut size

1. Print the labels on **plain paper** first (same printer settings as the calibration page that passed).
2. Cut along the **red cut line** (the template's own cut path). The artwork extends beyond it to the bleed frame, so a cut that is slightly off does not show white paper.
3. Measure the cut label with calipers and compare with the proof's **Cut line** size (for example CL4RC Standard: 88.900 × 40.919 mm).
   A difference under about 0.3 mm is normal for hand cutting; larger means the print scale or the cutting is off.

## Step 4: compare the label against the cassette

Hold the cut paper label against the shell *before* using sticker stock:

1. Place it over the label recess of the **actual cassette**. Check all four edges, the corners, and any step or rim.
2. Check the **window / hub area** against the printed oval or circles. Text must not sit over the window or hubs.
3. Look for overhang (label wider or taller than the recess), gaps, and misaligned corners.
4. Photograph the label on the shell from straight above, with a ruler in the picture.

If the template has an inner shape marked "cutout", cut it out and check it lines up with the real window.

## Step 5: print on the real stock

Only after Steps 2 to 4 are fine: print on the sticker sheet, cut (or die-cut), peel and apply. Press the label from one edge to avoid bubbles and misalignment, and photograph it.

## Step 6: record the result

Copy `docs/fit-record-template.md`, fill it in and keep it (for example in `docs/fit-records/`). Record **every** discrepancy, even small ones, and what you think caused it.
One record per template, printer and cassette combination.

How to read the result:

- **Calibration is right but the label does not fit the shell**: the template geometry is not right for *that* shell. Record the measured recess size and which shell it is. The app deliberately does not let you edit a locked template; ask the template vendor which template matches your shell, or send them your measurements.
- **Calibration is off**: fix the printer settings (Step 1); the label cannot be trusted until the square is right.
- **Calibration right, label fits**: mark the record **Fit-verified** for that template, printer and cassette. It says nothing about other shells or printers.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Everything about 95 to 97% of the right size | "Fit to page" / "Shrink to fit" is on | Turn it off, print at 100% / Actual size |
| Right size but cut by an inch at the page edge | Printer margins ("non-printable area") | Use the 12-up or single-label export on the vendor sheet; check the printer's minimum margin |
| Horizontal and vertical differ by 0.2 to 0.4 mm | Paper feed scale of the printer | Note it in the record; it is a printer property |
| Colours differ from the screen | The app outputs RGB, not CMYK or spot colours | Print a colour test; use a print shop for colour-critical work |
| Fonts look different from the preview | A font that forbids embedding was replaced by Helvetica | The proof lists it under Font embedding; choose another font |
| White edge after cutting | Cut on the wrong side of the line or print offset | Cut on the red line; artwork already runs to the bleed frame |
| Label slightly too big or small for the shell | The shell differs from the template | See Step 6; this is a template problem, not a print problem |

## What this guide cannot tell you

The software has not been tested against a printed label on any cassette shell. All dimensions come from the supplied vendor template files and are
reproduced exactly in the PDF, but **physical fit remains unverified until you complete Steps 1 to 6 and record the result.**
