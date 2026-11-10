# CutPlan v0.6.4 — Benchmark report

**Run date:** 10 November 2026  
**Environment:** Node.js on the same runtime for all paired runs.  
**Comparison method:** Each old/new comparison uses identical row data, stock dimensions, kerf, margin, cutting mode and deterministic seed (61110). Deep and Standard are compared separately. All v0.6.4 accepted plans pass the hierarchical guillotine validator. Runtime is one run per dataset and should be treated as indicative only, not a statistical performance claim.

## Search portfolio

| Effort | Strategy candidates | Additional board-reduction probes | Maximum attempts |
|---|---:|---:|---:|
| Quick | 12 | Up to 4 when multi-board | 16 |
| Standard | 64 | Up to 4 when multi-board | 68 |
| Deep | 192 | Up to 4 when multi-board | 196 |

Standard and Deep preserve the previous v0.6.2 portfolio (48 and 144 candidates) and add 16 and 48 fragment/offcut-aware candidates respectively. The extra candidates are targeted strategy variants, not an arbitrary increase to a huge random-start count. The seeded search remains deterministic. Board count is the first objective; the algorithm does not accept another stock board for a small utilization or offcut improvement.

## v0.6.2 → v0.6.4: Deep offcut-quality comparison

The frozen v0.6.2 engine bundled in `benchmark-fixtures/v0.6.2-nesting-engine.js` and the v0.6.4 engine ran on the same eight datasets in Deep mode. Stock was 2440 × 1200 mm, except the guillotine-hard and hard-mixed datasets at 2440 × 1220 mm. Margin was 5 mm, kerf 4 mm (hard mixed was 3 mm), optimal cutting mode, seed 61110.

| Dataset | Pieces | Boards v0.6.2 → v0.6.4 | Utilization | Reusable offcut area v0.6.2 → v0.6.4 | Small scrap boxes v0.6.2 → v0.6.4 | Attempts v0.6.2 → v0.6.4 |
|---|---:|---:|---:|---:|---:|---:|
| Reference | 51 | 5 → 5 | 75.30% → 75.30% | 3.131 → 3.141 m² | 12 → 11 | 148 → 196 |
| Many small | 90 | 1 → 1 | 25.58% → 25.58% | 1.993 → 1.993 m² | 20 → 20 | 144 → 192 |
| Narrow | 30 | 1 → 1 | 42.00% → 42.00% | 1.527 → 1.527 m² | 0 → 0 | 144 → 192 |
| Mixed | 39 | 4 → 4 | 77.86% → 77.86% | 2.026 → 2.183 m² | 20 → 9 | 148 → 196 |
| Rotation disabled | 24 | 2 → 2 | 68.33% → 68.33% | 1.676 → 1.676 m² | 1 → 1 | 148 → 196 |
| Repeated parts | 160 | 13 → 13 | 80.00% → 80.00% | 5.903 → 5.903 m² | 45 → 45 | 148 → 196 |
| Difficult guillotine | 17 | 2 → 2 | 78.16% → 78.16% | 1.071 → 1.071 m² | 4 → 4 | 148 → 196 |
| Hard mixed | 35 | 3 → 3 | 84.57% → 84.57% | 0.780 → 0.780 m² | 23 → 23 | 148 → 196 |

**Measured result:** Board count and utilization were unchanged across all eight data sets. On the mixed 39-piece set, the Deep portfolio increased reusable offcut area by **156,613 mm²** (about 7.7%), reduced small-scrap rectangles from **20 to 9**, and reduced the total free-rectangle count from 42 to 41. The reference set gained 9,766 mm² of reusable area and reduced small-scrap rectangles from 12 to 11. The other six datasets had the same measured reusable area and scrap count.

## v0.6.2 → v0.6.4: Standard offcut-quality comparison

The same eight datasets and stock settings were run using Standard instead of Deep.

| Dataset | Pieces | Boards v0.6.2 → v0.6.4 | Utilization | Reusable offcut area v0.6.2 → v0.6.4 | Small scrap boxes v0.6.2 → v0.6.4 | Attempts v0.6.2 → v0.6.4 |
|---|---:|---:|---:|---:|---:|---:|
| Reference | 51 | 5 → 5 | 75.30% → 75.30% | 3.087 → 3.141 m² | 9 → 11 | 52 → 68 |
| Many small | 90 | 1 → 1 | 25.58% → 25.58% | 1.989 → 1.993 m² | 20 → 20 | 48 → 64 |
| Narrow | 30 | 1 → 1 | 42.00% → 42.00% | 1.527 → 1.527 m² | 0 → 0 | 48 → 64 |
| Mixed | 39 | 4 → 4 | 77.86% → 77.86% | 2.026 → 2.026 m² | 20 → 20 | 52 → 68 |
| Rotation disabled | 24 | 2 → 2 | 68.33% → 68.33% | 1.676 → 1.676 m² | 1 → 1 | 52 → 68 |
| Repeated parts | 160 | 13 → 13 | 80.00% → 80.00% | 5.903 → 5.903 m² | 45 → 45 | 52 → 68 |
| Difficult guillotine | 17 | 2 → 2 | 78.16% → 78.16% | 1.071 → 1.071 m² | 4 → 4 | 52 → 68 |
| Hard mixed | 35 | 3 → 3 | 84.57% → 84.57% | 0.780 → 0.780 m² | 23 → 23 | 52 → 68 |

**Measured result:** Standard retained the same board count and utilization across all eight. Reusable offcut area improved slightly on Reference (+54,651 mm²) and Many small (+3,872 mm²), but the Reference scrap-box count increased from 9 to 11. The other six datasets were unchanged on these fields. Standard is therefore not a uniform offcut-quality improvement; the stronger reduction on the Mixed set appears in Deep mode.

## Runtime observations

The current portfolio evaluates more candidates than v0.6.2, and most measured runs therefore took longer. In the Deep run, for example, the 160-piece repeated case recorded 247 ms in v0.6.2 and 411 ms in v0.6.4; in Standard it recorded 70 ms and 114 ms. These are single runs, not stable benchmark averages. The extra time is the cost of the wider targeted strategy portfolio. Do not describe this release as faster without repeated measurements on the target workshop machine.

The exact paired observations are preserved in:

- `COMPARISON-V062-V063-deep.json` and `COMPARISON-V062-V063-deep.csv`
- `COMPARISON-V062-V063-standard.json` and `COMPARISON-V062-V063-standard.csv`

## Historical v0.5.0 → v0.6.2 benchmark

The first optimization release compared the original v0.5.0 engine with the then-current v0.6.2 engine. Its historical results are retained in `BENCHMARK-RESULTS.csv` and the previous archived report output. The difficult 35-piece case was reduced from 4 boards to 3 (84.57% utilization versus 63.43%) with valid guillotine geometry. That board-count improvement was already present in v0.6.2 and is not a new v0.6.4 result.

## Measurement caveats

- The old v0.6.2 engine did not expose the same `offcutCount` and classification metrics as v0.6.4 in its public result. The comparison script reconstructs old reusable area from its returned free rectangles and classifies old scrap using the same size threshold (short side under 100 mm or area under 10,000 mm²). Treat these as post-processed comparators, not historic built-in old-engine statistics.
- The original v0.5.0 engine did not measure reusable offcuts; historical values are `not-measured`, not zero.
- Runtime values are one-shot measurements and vary with CPU, browser/runtime and load. Repeat multiple runs on target hardware before drawing performance conclusions.
- The search is a deterministic heuristic portfolio, not a mathematical proof of global optimality. No global optimum is claimed. Full part-by-part relocate/swap repair and beam search remain future work.
- The layouts remain guillotine-only. All accepted plans are checked against the reconstructed hierarchical cut tree; arbitrary non-guillotine rectangle packing is not used as a final placement method.
