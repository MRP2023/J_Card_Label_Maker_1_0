# Fit record

Copy this file for every template / printer / cassette combination you test (for example `docs/fit-records/2025-01-12-cl4rc-epson.md`).
A CSV version of the same fields for a spreadsheet is in `docs/fit-record-template.csv`.

## 1. What was tested

| Field | Value |
| --- | --- |
| Date | |
| Tester | |
| App version / export file name | |
| Template (id and name) | e.g. `cl4rc-standard-2024` |
| Export mode | desktop / single / 12-up sheet |
| Paper size in the PDF | A4 / Letter |
| Cut lines printed | yes / no |
| Fonts used (and whether embedded) | |
| Automatic export verification shown by the app | e.g. "All 10 checks passed" |

## 2. Printer and settings

| Field | Value |
| --- | --- |
| Printer make and model | |
| Driver / viewer used to print | |
| Scale setting | must be 100% / Actual size |
| "Fit to page" / "Shrink to fit" | OFF (confirm) |
| Borderless | OFF (confirm) |
| Paper / sticker stock (brand, type) | |
| Print quality mode | |

## 3. Calibration (page printed first, plain paper)

| Measurement | Expected | Measured | Difference | Pass (±0.2 mm square, ±0.5 mm ruler)? |
| --- | --- | --- | --- | --- |
| 10 mm square, horizontal | 10.00 mm | | | |
| 10 mm square, vertical | 10.00 mm | | | |
| 100 mm ruler | 100.0 mm | | | |

Calibration passed: **yes / no**. If no, stop here and fix the print settings.

## 4. The cut label

| Measurement | Expected (from the proof) | Measured | Difference |
| --- | --- | --- | --- |
| Cut width | e.g. 88.900 mm | | |
| Cut height | e.g. 40.919 mm | | |
| Corner radius looks right (compare with the proof) | | | |
| Inner shape (window / hubs), if cut out | | | |

## 5. Comparison with the cassette

| Field | Value |
| --- | --- |
| Cassette shell: maker, model, colour, year | |
| Measured label recess width x height | |
| Edges: aligned / label too large / label too small | |
| Corners: match / do not match | |
| Window / hubs: aligned / offset by about ___ mm (direction) | |
| Text clear of the window and hubs | yes / no |
| Anything catching, overhanging or leaving a gap | |

Photos attached (label on the shell, with a ruler): yes / no. File names: ______

## 6. Discrepancies and cause

List every difference, however small, and the most likely cause (printer scale, hand cutting, wrong template for the shell, other).

1.
2.
3.

## 7. Verdict

- [ ] **Fit-verified**: printed at 100%, calibration passed, cut label matches the proof within 0.3 mm, and it fits this cassette shell.
- [ ] **Needs adjustment**: calibration passed but the label does not fit this shell (wrong template for the shell). Details in section 6.
- [ ] **Print problem**: calibration failed; labels cannot be judged until it passes.

This record only covers the template, printer and cassette named above.
