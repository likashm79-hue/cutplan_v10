/* CutPlan v0.4.3 — deterministic multi-start, multi-stage guillotine optimizer.
 * Every placed part is taken from a rectangular free region. Each placement
 * divides that region using full straight cuts, leaving only rectangular
 * offcuts. 'width' means the primary cut runs across the sheet width (H);
 * 'length' means the primary cut runs along the sheet length (V). 'optimum'
 * evaluates both cut orders. This is a heuristic, not a proof of global optimum.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CutPlanEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 1e-7;
  const ORDER = ['area', 'long', 'short', 'perimeter', 'input', 'width', 'length', 'aspect'];
  const SEARCH_STARTS = { standard: 12, high: 64, max: 240 };

  function numberValue(value, label, min = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min) throw new Error(`${label} must be at least ${min}.`);
    return n;
  }

  function normalizeBanding(banding) {
    const b = banding || {};
    return { top: !!b.top, right: !!b.right, bottom: !!b.bottom, left: !!b.left };
  }

  function normalizeEdgeBandingSpec(spec) {
    const source = spec || {};
    const read = (material, axis) => {
      const value = Number(source[material]?.[axis] ?? 0);
      if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
        throw new Error(`Edge-banding count for ${material} mm (${axis}) must be a non-negative whole number.`);
      }
      return value;
    };
    return {
      '0.8': { length: read('0.8', 'length'), width: read('0.8', 'width') },
      '2': { length: read('2', 'length'), width: read('2', 'width') }
    };
  }

  function edgeMap(banding, rotated) {
    if (!rotated) return normalizeBanding(banding);
    // A 90-degree clockwise part rotation: old L→new T, T→new R, R→new B, B→new L.
    return {
      top: !!banding.left,
      right: !!banding.top,
      bottom: !!banding.right,
      left: !!banding.bottom
    };
  }

  function expandRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('Add at least one cutting-list row.');
    const output = [];
    const ids = new Set();
    rows.forEach((row, index) => {
      const rowId = String(row.rowId ?? index + 1).trim();
      const normalizedId = rowId.toLowerCase();
      if (!rowId || ids.has(normalizedId)) throw new Error(`Missing or duplicate cutting-list reference: ${rowId || index + 1}.`);
      ids.add(normalizedId);
      const length = numberValue(row.length, `Row ${rowId} length`, 0.001);
      const width = numberValue(row.width, `Row ${rowId} width`, 0.001);
      const qty = numberValue(row.qty, `Row ${rowId} quantity`, 1);
      if (!Number.isInteger(qty)) throw new Error(`Row ${rowId} quantity must be a whole number.`);
      for (let unit = 1; unit <= qty; unit++) {
        output.push({
          rowId, unit, rowQty: qty, length, width,
          rotate: !!row.rotate,
          edgeBanding: normalizeBanding(row.edgeBanding),
          edgeBandingSpec: normalizeEdgeBandingSpec(row.edgeBandingSpec),
          area: length * width,
          inputIndex: index
        });
      }
    });
    return output;
  }

  function hashText(text) {
    // Stable integer hash; no nondeterministic Math.random() in optimization.
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function sortItems(items, strategy) {
    const { order: key, reverse, seed, shuffle } = strategy;
    const value = item => {
      switch (key) {
        case 'area': return item.area;
        case 'long': return Math.max(item.length, item.width);
        case 'short': return Math.min(item.length, item.width);
        case 'perimeter': return item.length + item.width;
        case 'width': return item.width;
        case 'length': return item.length;
        case 'aspect': return Math.max(item.length, item.width) / Math.min(item.length, item.width);
        default: return item.inputIndex;
      }
    };
    return items.slice().sort((a, b) => {
      if (shuffle) {
        return hashText(`${a.rowId}|${a.unit}|${seed}`) - hashText(`${b.rowId}|${b.unit}|${seed}`);
      }
      const difference = value(b) - value(a);
      if (Math.abs(difference) > EPS) return reverse ? -difference : difference;
      const ah = hashText(`${a.rowId}|${a.unit}|${seed}`);
      const bh = hashText(`${b.rowId}|${b.unit}|${seed}`);
      return ah - bh || a.inputIndex - b.inputIndex || a.unit - b.unit;
    });
  }

  function strategiesFor(effort) {
    const count = SEARCH_STARTS[effort] || SEARCH_STARTS.high;
    const strategies = [];
    for (const order of ORDER) {
      for (const reverse of [false, true]) {
        strategies.push({ order, reverse, seed: 0, shuffle: false, scoreType: 'short' });
      }
    }
    const scoreTypes = ['short', 'long', 'maxrect', 'balance'];
    for (let seed = 1; strategies.length < count; seed++) {
      for (let scoreIndex = 0; scoreIndex < scoreTypes.length && strategies.length < count; scoreIndex++) {
        strategies.push({ order: 'shuffle', reverse: false, seed, shuffle: true, scoreType: scoreTypes[scoreIndex] });
      }
    }
    return strategies.slice(0, count);
  }

  function fitOptions(item, free, cfg, mode, scoreType) {
    const orientations = [{ w: item.length, h: item.width, rotated: false }];
    if (item.rotate && item.length !== item.width) {
      orientations.push({ w: item.width, h: item.length, rotated: true });
    }

    const options = [];
    for (const orientation of orientations) {
      const reserveW = orientation.w + (orientation.w < free.w - EPS ? cfg.kerf : 0);
      const reserveH = orientation.h + (orientation.h < free.h - EPS ? cfg.kerf : 0);
      if (reserveW > free.w + EPS || reserveH > free.h + EPS) continue;

      const remainingW = Math.max(0, free.w - reserveW);
      const remainingH = Math.max(0, free.h - reserveH);
      const cutOrders = mode === 'optimum' ? ['V', 'H'] : [mode === 'width' ? 'H' : 'V'];
      for (const cut of cutOrders) {
        const childA = cut === 'V' ? remainingW * free.h : free.w * remainingH;
        const childB = cut === 'V' ? reserveW * remainingH : remainingW * reserveH;
        const shortSide = Math.min(remainingW, remainingH);
        const longSide = Math.max(remainingW, remainingH);
        const largestChild = Math.max(childA, childB);
        const balance = Math.abs(childA - childB);
        let score;
        if (scoreType === 'long') score = [longSide, shortSide, -largestChild, orientation.rotated ? 1 : 0];
        else if (scoreType === 'maxrect') score = [-largestChild, shortSide, longSide, orientation.rotated ? 1 : 0];
        else if (scoreType === 'balance') score = [balance, -largestChild, shortSide, orientation.rotated ? 1 : 0];
        else score = [shortSide, longSide, -largestChild, orientation.rotated ? 1 : 0];
        options.push({ ...orientation, reserveW, reserveH, cut, score });
      }
    }
    return options;
  }

  function compareScore(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (Math.abs(a[i] - b[i]) > EPS) return a[i] - b[i];
    }
    return 0;
  }

  function recordCut(sheet, axis, x, y, length, kerf, region) {
    if (length <= EPS) return;
    sheet.cuts.push({
      axis, x, y, length, kerf,
      region: { x: region.x, y: region.y, w: region.w, h: region.h },
      sequence: sheet.cuts.length + 1
    });
  }

  function pack(items, cfg, strategy, mode) {
    const sheets = [];
    const orderedItems = sortItems(items, strategy);

    for (const item of orderedItems) {
      let best = null;
      for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
        for (let freeIndex = 0; freeIndex < sheets[sheetIndex].free.length; freeIndex++) {
          const free = sheets[sheetIndex].free[freeIndex];
          for (const option of fitOptions(item, free, cfg, mode, strategy.scoreType)) {
            const candidate = { sheetIndex, freeIndex, x: free.x, y: free.y, ...option };
            if (!best || compareScore(candidate.score, best.score) < 0) best = candidate;
          }
        }
      }

      if (!best) {
        const free = { x: cfg.margin, y: cfg.margin, w: cfg.usableW, h: cfg.usableH };
        const options = fitOptions(item, free, cfg, mode, strategy.scoreType);
        if (!options.length) {
          throw new Error(`Row ${item.rowId} (${item.length} × ${item.width} mm) cannot fit on the usable sheet.`);
        }
        sheets.push({ free: [free], placed: [], cuts: [] });
        const sheetIndex = sheets.length - 1;
        const option = options.slice().sort((a, b) => compareScore(a.score, b.score))[0];
        best = { sheetIndex, freeIndex: 0, x: free.x, y: free.y, ...option };
      }

      const sheet = sheets[best.sheetIndex];
      const free = sheet.free.splice(best.freeIndex, 1)[0];
      const placed = {
        rowId: item.rowId, unit: item.unit, rowQty: item.rowQty,
        length: item.length, width: item.width,
        x: free.x, y: free.y,
        w: best.w, h: best.h,
        rotated: best.rotated,
        sourceEdgeBanding: normalizeBanding(item.edgeBanding),
        edgeBanding: edgeMap(item.edgeBanding, best.rotated),
        edgeBandingSpec: normalizeEdgeBandingSpec(item.edgeBandingSpec)
      };
      sheet.placed.push(placed);

      const remainingW = Math.max(0, free.w - best.reserveW);
      const remainingH = Math.max(0, free.h - best.reserveH);

      // Each branch starts from one rectangular free region and creates only
      // rectangular offcuts. Kerf is removed between the part and each offcut.
      if (best.cut === 'V') {
        if (remainingW > EPS) {
          recordCut(sheet, 'vertical', free.x + best.w + cfg.kerf / 2, free.y, free.h, cfg.kerf, free);
          sheet.free.push({ x: free.x + best.reserveW, y: free.y, w: remainingW, h: free.h });
        }
        if (remainingH > EPS) {
          recordCut(sheet, 'horizontal', free.x, free.y + best.h + cfg.kerf / 2, best.reserveW, cfg.kerf, {
            x: free.x, y: free.y, w: best.reserveW, h: free.h
          });
          sheet.free.push({ x: free.x, y: free.y + best.reserveH, w: best.reserveW, h: remainingH });
        }
      } else {
        if (remainingH > EPS) {
          recordCut(sheet, 'horizontal', free.x, free.y + best.h + cfg.kerf / 2, free.w, cfg.kerf, free);
          sheet.free.push({ x: free.x, y: free.y + best.reserveH, w: free.w, h: remainingH });
        }
        if (remainingW > EPS) {
          recordCut(sheet, 'vertical', free.x + best.w + cfg.kerf / 2, free.y, best.reserveH, cfg.kerf, {
            x: free.x, y: free.y, w: free.w, h: best.reserveH
          });
          sheet.free.push({ x: free.x + best.reserveW, y: free.y, w: remainingW, h: best.reserveH });
        }
      }
    }
    return sheets;
  }

  function validate(sheets, cfg, expectedItems) {
    const placed = [];
    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
      const sheet = sheets[sheetIndex];
      for (const part of sheet.placed) {
        if (part.x < cfg.margin - EPS || part.y < cfg.margin - EPS ||
            part.x + part.w > cfg.sheetLength - cfg.margin + EPS ||
            part.y + part.h > cfg.sheetWidth - cfg.margin + EPS) {
          throw new Error(`Guillotine validation: row ${part.rowId} is outside the usable sheet.`);
        }
        placed.push({ ...part, sheetIndex });
      }
      for (let i = 0; i < sheet.placed.length; i++) {
        const a = sheet.placed[i];
        for (let j = i + 1; j < sheet.placed.length; j++) {
          const b = sheet.placed[j];
          const overlap = a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS &&
                          a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
          if (overlap) throw new Error(`Guillotine validation: row ${a.rowId} overlaps row ${b.rowId}.`);
        }
      }
      // Every recorded saw path must lie inside the rectangular region it splits.
      for (const cut of sheet.cuts) {
        const r = cut.region;
        if (!r || cut.length <= 0) throw new Error('Guillotine validation: invalid cut record.');
        if (cut.axis === 'vertical') {
          if (cut.x < r.x - EPS || cut.x > r.x + r.w + EPS || Math.abs(cut.y-r.y)>EPS || Math.abs(cut.length-r.h)>EPS) {
            throw new Error('Guillotine validation: vertical cut must span the full height of its parent rectangle.');
          }
        } else if (cut.axis === 'horizontal') {
          if (cut.y < r.y - EPS || cut.y > r.y + r.h + EPS || Math.abs(cut.x-r.x)>EPS || Math.abs(cut.length-r.w)>EPS) {
            throw new Error('Guillotine validation: horizontal cut must span the full width of its parent rectangle.');
          }
        } else throw new Error('Guillotine validation: unknown cut direction.');
      }
    }

    if (placed.length !== expectedItems.length) {
      throw new Error(`Only ${placed.length} of ${expectedItems.length} pieces were placed.`);
    }
    const expected = new Map();
    expectedItems.forEach(item => expected.set(`${item.rowId}|${item.unit}`, item));
    const found = new Set();
    for (const part of placed) {
      const key = `${part.rowId}|${part.unit}`;
      if (!expected.has(key) || found.has(key)) throw new Error(`Guillotine validation: missing, duplicate or unknown piece ${key}.`);
      found.add(key);
    }
    if (found.size !== expected.size) throw new Error('Guillotine validation: one or more requested pieces are missing.');
    return placed.length;
  }

  function candidateQuality(sheets) {
    let envelopeArea = 0;
    let freeRegions = 0;
    let cutLength = 0;
    for (const sheet of sheets) {
      freeRegions += sheet.free.length;
      for (const cut of sheet.cuts) cutLength += cut.length;
      if (!sheet.placed.length) continue;
      const minX = Math.min(...sheet.placed.map(p => p.x));
      const minY = Math.min(...sheet.placed.map(p => p.y));
      const maxX = Math.max(...sheet.placed.map(p => p.x + p.w));
      const maxY = Math.max(...sheet.placed.map(p => p.y + p.h));
      envelopeArea += (maxX - minX) * (maxY - minY);
    }
    return { envelopeArea, freeRegions, cutLength };
  }

  function isBetter(candidate, best) {
    if (!best) return true;
    if (candidate.sheets.length !== best.sheets.length) return candidate.sheets.length < best.sheets.length;
    if (Math.abs(candidate.quality.envelopeArea - best.quality.envelopeArea) > EPS) return candidate.quality.envelopeArea < best.quality.envelopeArea;
    if (candidate.quality.freeRegions !== best.quality.freeRegions) return candidate.quality.freeRegions < best.quality.freeRegions;
    if (Math.abs(candidate.quality.cutLength - best.quality.cutLength) > EPS) return candidate.quality.cutLength < best.quality.cutLength;
    return false;
  }

  function optimize(rows, options = {}) {
    const sheetLength = numberValue(options.sheetLength, 'Sheet length', 1);
    const sheetWidth = numberValue(options.sheetWidth, 'Sheet width', 1);
    const kerf = numberValue(options.kerf ?? 0, 'Kerf', 0);
    const margin = numberValue(options.margin ?? 0, 'Edge margin', 0);
    if (2 * margin >= Math.min(sheetLength, sheetWidth)) throw new Error('Edge margin is too large.');

    const mode = options.cutMode || 'optimum';
    if (!['width', 'length', 'optimum'].includes(mode)) throw new Error('Choose Cut along width, Cut along length or Optimal.');

    const items = expandRows(rows);
    const cfg = {
      sheetLength, sheetWidth, kerf, margin,
      usableW: sheetLength - 2 * margin,
      usableH: sheetWidth - 2 * margin
    };
    const strategies = strategiesFor(options.effort || 'high');
    let best = null;
    let validAttempts = 0;

    for (const strategy of strategies) {
      let sheets;
      try {
        sheets = pack(items, cfg, strategy, mode);
        validate(sheets, cfg, items);
        validAttempts++;
      } catch (error) {
        // A failed strategy is skipped; the final error is reported if all fail.
        continue;
      }
      const candidate = { sheets, strategy, quality: candidateQuality(sheets) };
      if (isBetter(candidate, best)) best = candidate;
    }

    if (!best) throw new Error('No feasible guillotine layout found. Increase the sheet size or verify dimensions and rotation settings.');

    const pieces = validate(best.sheets, cfg, items);
    const partArea = items.reduce((sum, item) => sum + item.area, 0);
    const edgeBandingTotalsMm = items.reduce((totals, item) => {
      const spec = item.edgeBandingSpec;
      totals['0.8'] += item.length * spec['0.8'].length + item.width * spec['0.8'].width;
      totals['2'] += item.length * spec['2'].length + item.width * spec['2'].width;
      return totals;
    }, { '0.8': 0, '2': 0 });
    const grossSheetArea = sheetLength * sheetWidth * best.sheets.length;
    return {
      sheets: best.sheets,
      sheetLength, sheetWidth, kerf, margin,
      rows: rows.length, pieces, partArea, grossSheetArea,
      wasteArea: grossSheetArea - partArea,
      edgeBandingTotalsMm,
      utilization: partArea / grossSheetArea * 100,
      attempts: strategies.length,
      validAttempts,
      ordering: best.strategy.order,
      cutMode: mode,
      validated: true,
      guillotine: true,
      heuristic: true
    };
  }

  return { optimize, expandRows, validate, normalizeEdgeBandingSpec };
});
