# CutPlan v1.0.0

CutPlan is a browser-based cutting-list and board-nesting tool for furniture, cabinet, wardrobe and panel workshops. This release removes the separate **Items needing review** queue and changes import to an order-preserving, main-list-first workflow.

## v1.0.0 changes

- **No separate review queue:** all usable part-like candidates detected from PDF, image, OCR text or CSV are inserted directly into the main cutting-list table in source order.
- **Permissive row capture:** quantities above 10 are accepted into the list; decimal-looking OCR dimensions are normalized to whole millimetres; missing quantities default to 1; excess edge markers are capped at two. Any automatic normalization is noted on that row.
- **Duplicate rows are preserved:** repeated references are not discarded. Later duplicates receive a unique suffix (`A1-2`, `A1-3`, etc.) and the original reference stays in the source metadata.
- **Context in the Row Editor:** each imported row displays its original source line and any parser notes while editing. Open Row Editor and use Next / Previous to inspect the full list in order.
- **Document-noise filtering:** common headers, column headings, page counters, board/sheet metadata, totals and lines without a valid dimension pair are excluded from the part rows.
- **Stronger PDF import:** digital text is grouped by geometric baselines and column gaps page-by-page. Pages that look under-read are selectively cross-checked with two Tesseract page segmentation modes (PSM 6 and PSM 11); only OCR pages with a better row yield replace the digital page.
- **Image OCR cross-check:** image uploads are recognized with both PSM 6 and PSM 11, and the result with the stronger row yield (confidence as tie-breaker) is selected.
- **Preserved production features:** nesting optimizer, deterministic search, guillotine cut-tree validation, edge-banding calculations, row editor, board drawings, amber unlabeled offcuts, and A4 print/PDF layout remain in place.

## Import workflow

1. Select a PDF or image and choose **Read PDF / image**.
2. Check the recognized text if needed, then choose **Parse rows**.
3. All detected part rows appear in the main table, in the order they were found in the source. Non-part document lines are filtered.
4. Open **Row Editor** and step through the rows. The editor shows the original source line and any parser notes so the operator can correct reference, length, width, quantity, rotation and edge-banding counts.
5. Verify the full cutting list against the source document before optimizing and before production cutting.

## Parsing policy and important limits

- Parsed length and width are always whole-number millimetres. Decimal-looking OCR values are rounded to the nearest millimetre and flagged in the row editor's parser note; check and correct these values against the source.
- Missing or unreadable quantity defaults to 1 with a parser note. Quantities above 10 are not blocked; valid values up to 10,000 are retained.
- Edge counts are limited to two per material per dimension. Larger OCR marker runs are capped at two and noted.
- Repeated part references are retained with unique display references. Check whether the duplicate represents a genuinely separate line or a repeated OCR capture.
- A line must yield at least two plausible dimensions to become a part row. Headers, totals, page numbers and document metadata are filtered.
- OCR is not guaranteed to be correct on every scan. Always inspect the main list before optimization/cutting. The actual large workshop PDF should be used for final acceptance testing.

## Run on Ubuntu / Linux

Extract the ZIP, then run from the project directory:

```bash
cd ~/Downloads/CutPlan-v1.0.0
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000` in Chrome or Chromium. Keep `index.html`, `cutting-list-parser.js`, `nesting-engine.js`, `drawing-layout.js` and `nesting-worker.js` together. Use localhost rather than opening `index.html` as a `file://` URL.

The optimizer and parser run in the browser. PDF.js and Tesseract.js load from jsDelivr for PDF/image extraction and OCR, so those import features require an internet connection.

## Tests

Run these commands from the project directory:

```bash
node backup-v0.5.0/test-engine.js
node test-engine.js
node test-drawings.js
node test-v100-parser.js
python3 test-v100-ui.py
```

`test-v100-ui.py` runs the interface in headless Chromium and saves the UI/PDF verification files in `verification/`.

## Verification boundary

The v1.0.0 automated suite tests a 12-page synthetic PDF with 96 rows, order preservation, duplicate references, high quantities, decimal OCR normalization, packed same-line rows, document-noise filtering, selective page OCR, both OCR segmentation modes, row-editor navigation, optimizer execution and PDF rendering. The exact workshop PDF that previously mis-parsed was not supplied with this task, so accuracy on that particular file is not yet independently confirmed.
# cutplan_v10
