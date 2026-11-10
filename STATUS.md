# CutPlan v1.0.0 — Release status

**State:** v1.0.0 complete and locally verified.  
**Date:** 10 November 2026.

## Completed

- [x] Removed the separate `Items needing review` section and all of its resolution workflow from the active interface.
- [x] Parser imports usable part rows directly into the main cutting-list table in original source order.
- [x] High quantities above 10 are imported instead of held back; values are bounded by the editor's supported maximum of 10,000.
- [x] Decimal-looking OCR dimensions are normalized to whole millimetres with an in-row parser note.
- [x] Missing quantity defaults to 1 and is noted on the row.
- [x] Duplicate references are preserved using unique suffixes rather than being silently discarded.
- [x] Excess edge markers are capped at two per side/dimension and noted.
- [x] Common headers, page counters, totals, sheet/board metadata and lines without a plausible dimension pair are filtered.
- [x] Row Editor shows the original extracted source line and any parsing notes for the active row.
- [x] PDF import checks every page, measures row yield, and selectively runs two OCR segmentation modes on pages that appear under-read.
- [x] Image OCR compares PSM 6 and PSM 11 and chooses the result with the better detected-row yield.
- [x] Preserved optimizer, cut-tree validation, banding totals, board drawings and print/PDF layout.

## Verification

- `node test-engine.js`: PASS.
- `node test-drawings.js`: PASS.
- `node test-v100-parser.js`: PASS.
- `python3 test-v100-ui.py`: PASS in headless Chromium.
- 12-page synthetic PDF text extraction: 96 rows retained in order.
- Selective OCR test: only the under-read page was sent to OCR; PSM 6 and PSM 11 compared, stronger row yield selected.
- Quantity 11/25: imported directly into the main list.
- Decimal dimensions including `.0` and fractional values: normalized to integers with source/parser notes shown in Row Editor.
- Duplicate references: preserved with suffixes (`A1`, `A1-2`).
- Missing quantity: defaults to 1 with an in-row note.
- Headers/page totals/metadata and invalid dimension-only noise: filtered.
- Row Editor: full row fields saved and navigated with Previous / Next.
- Browser optimization and A4 PDF generation: PASS.

## Known verification limit

The suite uses a 12-page synthetic digital PDF and mocked OCR responses to test the multi-page and selective-OCR workflow. The exact large workshop PDF that previously mis-parsed was not attached, so real-file recognition accuracy is not yet established. Operator comparison against the original cutting list remains essential before production cutting.
