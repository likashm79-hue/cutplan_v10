# CutPlan v0.5.0

CutPlan converts furniture cutting lists into optimized board-cutting layouts that respect real-world multi-stage guillotine cutting constraints.

It is intended for furniture manufacturers, modular kitchen and wardrobe workshops, interior contractors, plywood cutting shops and small-to-medium production businesses.

## What this version delivers

- **PDF / image / CSV / manual input** with OCR fallback for scanned documents.
- **Alphanumeric reference preservation** (1A, 2KB, CAB-A1, …). Incomplete or noisy OCR lines are kept in an “Items needing review” editor instead of being discarded.
- **Independent 0.8 mm and 2 mm edge-banding** with automatic `_` / `~` detection and fully manual per-edge counts. Totals update immediately. Edge banding is **never** drawn on the board layouts.
- **Three cutting modes** (Cut along width, Cut along length, Optimal) sharing the same multi-stage guillotine engine.
- **Monochrome portrait technical drawings** with:
  - Solid board and part boundaries only (no dashed cutting-guide overlays).
  - Dimension values formatted as `780 mm` (space before unit, no “Length/Width” prefixes).
  - Original references inside parts when space allows.
  - Unique markers (① ② ③ …) inside every small / narrow part, with a matching external reference schedule.
  - Zero unlabelled parts.
- **One board = one A4 portrait PDF page** via the browser Print / Save PDF action.
- **Material dashboard** (boards, pieces, utilisation, waste, 0.8 mm and 2 mm banding metres).
- **Validation** of piece counts, bounds, overlaps and guillotine geometry before a plan is accepted.

## v0.5.0 changes (from v0.4.4)

- Removed all dashed cutting-guide overlays from board drawings. Only solid part and board outlines remain.
- Intelligent label placement:
  - Large / medium parts keep the original reference and dimension values inside the rectangle.
  - Small / narrow / extremely small parts receive a unique highly-visible marker and an external schedule entry of the form Marker · Reference · Dimensions · Qty.
  - No part is left without an identifiable label.
- Stronger validation messaging in the results panel (including explicit provisional zero-kerf warning).
- Version, footer and documentation updated.

The multi-stage guillotine nesting engine itself is unchanged from the validated v0.4.3 / v0.4.4 behaviour.

## Three cutting modes

- **Cut along width** — primary cuts run across the sheet width.
- **Cut along length** — primary cuts run along the sheet length.
- **Optimal** — evaluates both primary directions and keeps the better validated result.

All three modes obey the same rectangular free-region and full-span guillotine rules. The optimiser is a deterministic multi-start heuristic; it does not claim global optimality.

## Cutting-list input and edge-banding notation

Preferred row order:

```
Reference | Length | Width | Quantity
```

Rotation may appear as a fifth value in CSV or recognised text.

- References may be numeric or alphanumeric (`1A`, `2KB`, `CAB-A1`, …).
- Append one underscore `_` per edge that needs **0.8 mm** banding.
- Append one tilde `~` per edge that needs **2 mm** banding.
- Markers are independent. Example: `780__` = two 780 mm edges with 0.8 mm banding; `500_` = one 500 mm edge with 0.8 mm banding; `600~~` = two 600 mm edges with 2 mm banding.
- The row editor also exposes manual counts `0.8 L`, `0.8 W`, `2 L`, `2 W` (0–2 edges). Manual edits update the dashboard metres and CSV export immediately.
- OCR / PDF extraction is always a draft. Review every row and correct unresolved items before optimising.

Edge banding is a material estimate only. It never appears on the drawings and never changes cutting geometry.

## Drawing and PDF rules

- Portrait, monochrome boards.
- Dimensions written as `780 mm` (space before unit). No Length/Width prefixes.
- Original references preserved.
- Small parts identified by unique markers and an external schedule.
- No edge-banding colours, patterns, highlights, symbols or legends on drawings.
- No dashed cutting-guide overlays.
- One board occupies exactly one A4 portrait PDF page.

## Files

| File | Role |
|------|------|
| `index.html` | Browser UI, extraction, editor, drawings, print/PDF |
| `cutting-list-parser.js` | Reference, dimension-suffix and OCR parsing with unresolved-line recovery |
| `nesting-engine.js` | Multi-stage guillotine optimiser and geometry validation |
| `test-engine.js` | Node.js regression suite (benchmark, banding, parser recovery) |

## Run locally (Ubuntu / Linux)

Keep the four application files in one folder, then:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000 in a modern browser.

Internet access is required only for the optional Tesseract and PDF.js CDNs used by OCR / scanned-PDF import. The optimiser, editor and drawing engine run fully offline once the page has loaded.

## Run regression tests

```bash
node test-engine.js
```

## Production notes

- Set the real sheet size, measured blade kerf and edge margin before generating a production plan.
- A blank kerf is treated as 0 mm and is explicitly flagged as provisional.
- Always verify cut order, grain direction, clamping, trim allowance and banding requirements against the actual saw and job before cutting.
- The engine places parts only in rectangular free regions and splits those regions with straight guillotine cuts. Piece count, bounds, overlaps and recorded cut extents are validated.

## Known limitations

- OCR quality depends on scan resolution and lighting; always review extracted rows.
- The optimiser is heuristic; higher search effort improves results but does not guarantee a global optimum.
- Very large jobs (hundreds of distinct parts) may take several seconds at “Maximum” effort in the browser.
- Browser print-to-PDF is used for export; print margins and scaling can vary slightly between browsers. Prefer Chrome/Chromium for the most consistent A4 portrait output.
