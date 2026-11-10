/* CutPlan v0.6.0 — deterministic guillotine nesting and cut-tree validation.
 * Preserves the browser-only architecture of v0.5.0 while adding a diversified
 * search portfolio, measured search statistics and independently validated
 * hierarchical guillotine cuts. No arbitrary rectangle packing is used.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CutPlanEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 1e-7;
  const SEARCH_STARTS = { quick: 12, standard: 48, deep: 144 };
  const ORDER = ['area', 'long', 'short', 'perimeter', 'aspect', 'width', 'length', 'difficult', 'rotation', 'mixed', 'input'];
  const SCORES = ['short', 'long', 'area', 'balance', 'waste', 'offcut'];
  const REUSABLE_MIN_SIDE = 100;
  const REUSABLE_MIN_AREA = 10000;

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
    return { top: !!banding.left, right: !!banding.top, bottom: !!banding.right, left: !!banding.bottom };
  }
  function expandRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('Add at least one cutting-list row.');
    const output = [], ids = new Set();
    rows.forEach((row, index) => {
      const rowId = String(row.rowId ?? index + 1).trim();
      const normalizedId = rowId.toLowerCase();
      if (!rowId || ids.has(normalizedId)) throw new Error(`Missing or duplicate cutting-list reference: ${rowId || index + 1}.`);
      ids.add(normalizedId);
      const length = numberValue(row.length, `Row ${rowId} length`, 0.001);
      const width = numberValue(row.width, `Row ${rowId} width`, 0.001);
      const qty = numberValue(row.qty, `Row ${rowId} quantity`, 1);
      if (!Number.isInteger(qty)) throw new Error(`Row ${rowId} quantity must be a whole number.`);
      for (let unit = 1; unit <= qty; unit++) output.push({
        rowId, unit, rowQty: qty, length, width, rotate: !!row.rotate,
        edgeBanding: normalizeBanding(row.edgeBanding),
        edgeBandingSpec: normalizeEdgeBandingSpec(row.edgeBandingSpec),
        area: length * width, inputIndex: index
      });
    });
    return output;
  }
  function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }
  function seededValue(item, seed) { return hashText(`${item.rowId}|${item.unit}|${seed}`); }
  function sortItems(items, strategy, cfg) {
    const value = item => {
      const long = Math.max(item.length, item.width), short = Math.min(item.length, item.width);
      switch (strategy.order) {
        case 'area': return item.area;
        case 'long': return long;
        case 'short': return short;
        case 'perimeter': return item.length + item.width;
        case 'width': return item.width;
        case 'length': return item.length;
        case 'aspect': return long / short;
        case 'difficult': {
          const a = Math.max(0, cfg.usableW - item.length) + Math.max(0, cfg.usableH - item.width);
          const b = item.rotate ? Math.max(0, cfg.usableW - item.width) + Math.max(0, cfg.usableH - item.length) : Infinity;
          return -(Math.min(a, b) + (item.rotate ? 0 : Math.min(cfg.usableW, cfg.usableH) * 0.12));
        }
        case 'rotation': return item.rotate ? long * 0.25 + item.area / Math.max(1, cfg.usableW * cfg.usableH) : long;
        case 'mixed': return item.area * 0.55 + long * Math.min(cfg.usableW, cfg.usableH) * 0.45;
        default: return item.inputIndex;
      }
    };
    return items.slice().sort((a, b) => {
      if (strategy.shuffle) return seededValue(a, strategy.seed) - seededValue(b, strategy.seed) || a.inputIndex - b.inputIndex || a.unit - b.unit;
      const d = value(b) - value(a);
      if (Math.abs(d) > EPS) return strategy.reverse ? -d : d;
      const ah = seededValue(a, strategy.seed), bh = seededValue(b, strategy.seed);
      return ah - bh || a.inputIndex - b.inputIndex || a.unit - b.unit;
    });
  }
  function strategiesFor(effort, seed) {
    const count = SEARCH_STARTS[effort] || SEARCH_STARTS.standard;
    const strategies = [], seen = new Set();
    const add = strategy => {
      const signature = [strategy.order, !!strategy.reverse, strategy.seed, strategy.scoreType, !!strategy.shuffle].join('|');
      if (!seen.has(signature) && strategies.length < count) { seen.add(signature); strategies.push(strategy); }
    };
    // Spread the short portfolio across order families and split decisions.
    for (const scoreType of SCORES) for (const order of ORDER) add({ order, reverse: false, seed, shuffle: false, scoreType });
    for (const order of ORDER) add({ order, reverse: true, seed: seed + 1, shuffle: false, scoreType: 'offcut' });
    for (let n = 1; strategies.length < count; n++) {
      for (const scoreType of SCORES) add({ order: 'shuffle', reverse: false, seed: seed + n, shuffle: true, scoreType });
    }
    return strategies;
  }
  function offcutValue(w, h) {
    if (w <= EPS || h <= EPS) return 0;
    const area = w * h, short = Math.min(w, h), long = Math.max(w, h);
    if (short >= REUSABLE_MIN_SIDE && area >= REUSABLE_MIN_AREA) return area * (0.75 + 0.25 * short / long);
    return area * 0.005;
  }
  function fitOptions(item, free, cfg, mode, scoreType) {
    const orientations = [{ w: item.length, h: item.width, rotated: false }];
    if (item.rotate && item.length !== item.width) orientations.push({ w: item.width, h: item.length, rotated: true });
    const options = [];
    for (const orientation of orientations) {
      const reserveW = orientation.w + (orientation.w < free.w - EPS ? cfg.kerf : 0);
      const reserveH = orientation.h + (orientation.h < free.h - EPS ? cfg.kerf : 0);
      if (reserveW > free.w + EPS || reserveH > free.h + EPS) continue;
      const remainingW = Math.max(0, free.w - reserveW);
      const remainingH = Math.max(0, free.h - reserveH);
      const cutOrders = remainingW <= EPS && remainingH <= EPS ? ['none'] :
        remainingW <= EPS ? ['H'] : remainingH <= EPS ? ['V'] :
          mode === 'optimum' ? ['V', 'H'] : [mode === 'width' ? 'H' : 'V'];
      for (const cut of cutOrders) {
        // These are the actual two offcut rectangles after kerf removal.
        const childA = cut === 'V' ? remainingW * free.h : cut === 'H' ? free.w * remainingH : 0;
        const childB = cut === 'V' ? orientation.w * remainingH : cut === 'H' ? remainingW * orientation.h : 0;
        const shortSide = Math.min(remainingW, remainingH), longSide = Math.max(remainingW, remainingH);
        const largestChild = Math.max(childA, childB), balance = Math.abs(childA - childB);
        const unusable = (childA > 0 && (cut === 'V' ? Math.min(remainingW, free.h) : Math.min(free.w, remainingH)) < REUSABLE_MIN_SIDE ? childA : 0) +
          (childB > 0 && (cut === 'V' ? Math.min(orientation.w, remainingH) : Math.min(remainingW, orientation.h)) < REUSABLE_MIN_SIDE ? childB : 0);
        const useful = cut === 'V' ? offcutValue(remainingW, free.h) + offcutValue(orientation.w, remainingH) :
          cut === 'H' ? offcutValue(free.w, remainingH) + offcutValue(remainingW, orientation.h) : 0;
        let score;
        if (scoreType === 'long') score = [longSide, shortSide, -largestChild, orientation.rotated ? 1 : 0];
        else if (scoreType === 'area') score = [free.w * free.h - orientation.w * orientation.h, unusable, -useful, orientation.rotated ? 1 : 0];
        else if (scoreType === 'balance') score = [balance, -largestChild, shortSide, orientation.rotated ? 1 : 0];
        else if (scoreType === 'waste') score = [unusable, -useful, balance, orientation.rotated ? 1 : 0];
        else if (scoreType === 'offcut') score = [-useful, -largestChild, balance, orientation.rotated ? 1 : 0];
        else score = [shortSide, longSide, -largestChild, orientation.rotated ? 1 : 0];
        options.push({ ...orientation, reserveW, reserveH, remainingW, remainingH, cut, score });
      }
    }
    return options;
  }
  function compareScore(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (Math.abs(a[i] - b[i]) > EPS) return a[i] - b[i];
    return 0;
  }
  function makeLeaf(region) { return { type: 'leaf', region: { ...region }, part: null, children: null, cut: null }; }
  function recordCut(sheet, axis, x, y, length, kerf, region) {
    const cut = { axis, x, y, length, kerf, region: { x: region.x, y: region.y, w: region.w, h: region.h }, sequence: sheet.cuts.length + 1 };
    sheet.cuts.push(cut); return cut;
  }
  function splitLeaf(sheet, node, axis, firstRegion, secondRegion, cutLine) {
    const r = node.region;
    const cut = axis === 'vertical'
      ? recordCut(sheet, axis, cutLine, r.y, r.h, sheet.kerf, r)
      : recordCut(sheet, axis, r.x, cutLine, r.w, sheet.kerf, r);
    node.type = 'cut'; node.cut = cut;
    node.children = [makeLeaf(firstRegion), makeLeaf(secondRegion)];
    node.part = null;
    return node.children;
  }
  function appendFree(sheet, node) { sheet.free.push({ ...node.region, node }); }
  function placeInTree(sheet, free, option, placed, cfg) {
    const r = free.node.region, node = free.node;
    if (node.type !== 'leaf' || node.part) throw new Error('Internal guillotine tree error: attempted to reuse a non-empty leaf.');
    const w = option.w, h = option.h, remW = option.remainingW, remH = option.remainingH;
    if (option.cut === 'none') { node.part = placed; return; }
    if (option.cut === 'V') {
      if (remW > EPS) {
        const left = { x: r.x, y: r.y, w, h: r.h };
        const right = { x: r.x + option.reserveW, y: r.y, w: remW, h: r.h };
        const [leftNode, rightNode] = splitLeaf(sheet, node, 'vertical', left, right, r.x + w + cfg.kerf / 2);
        if (remH > EPS) {
          const top = { x: r.x, y: r.y, w, h };
          const bottom = { x: r.x, y: r.y + option.reserveH, w, h: remH };
          const [partNode, bottomNode] = splitLeaf(sheet, leftNode, 'horizontal', top, bottom, r.y + h + cfg.kerf / 2);
          partNode.part = placed; appendFree(sheet, bottomNode);
        } else leftNode.part = placed;
        appendFree(sheet, rightNode);
      } else if (remH > EPS) {
        const top = { x: r.x, y: r.y, w: r.w, h };
        const bottom = { x: r.x, y: r.y + option.reserveH, w: r.w, h: remH };
        const [partNode, bottomNode] = splitLeaf(sheet, node, 'horizontal', top, bottom, r.y + h + cfg.kerf / 2);
        partNode.part = placed; appendFree(sheet, bottomNode);
      } else node.part = placed;
    } else if (option.cut === 'H') {
      if (remH > EPS) {
        const top = { x: r.x, y: r.y, w: r.w, h };
        const bottom = { x: r.x, y: r.y + option.reserveH, w: r.w, h: remH };
        const [topNode, bottomNode] = splitLeaf(sheet, node, 'horizontal', top, bottom, r.y + h + cfg.kerf / 2);
        if (remW > EPS) {
          const left = { x: r.x, y: r.y, w, h };
          const right = { x: r.x + option.reserveW, y: r.y, w: remW, h };
          const [partNode, rightNode] = splitLeaf(sheet, topNode, 'vertical', left, right, r.x + w + cfg.kerf / 2);
          partNode.part = placed; appendFree(sheet, rightNode);
        } else topNode.part = placed;
        appendFree(sheet, bottomNode);
      } else if (remW > EPS) {
        const left = { x: r.x, y: r.y, w, h: r.h };
        const right = { x: r.x + option.reserveW, y: r.y, w: remW, h: r.h };
        const [partNode, rightNode] = splitLeaf(sheet, node, 'vertical', left, right, r.x + w + cfg.kerf / 2);
        partNode.part = placed; appendFree(sheet, rightNode);
      } else node.part = placed;
    } else throw new Error('Internal guillotine tree error: unknown split order.');
  }
  function pack(items, cfg, strategy, mode, maxSheets = Infinity) {
    const sheets = [], orderedItems = sortItems(items, strategy, cfg);
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
        if (sheets.length >= maxSheets) throw new Error('This candidate exceeds its board-count limit.');
        const region = { x: cfg.margin, y: cfg.margin, w: cfg.usableW, h: cfg.usableH };
        const free = { ...region, node: makeLeaf(region) };
        const options = fitOptions(item, free, cfg, mode, strategy.scoreType);
        if (!options.length) throw new Error(`Row ${item.rowId} (${item.length} × ${item.width} mm) cannot fit on the usable sheet.`);
        sheets.push({ free: [free], placed: [], cuts: [], kerf: cfg.kerf, cutTree: free.node });
        const sheetIndex = sheets.length - 1, option = options.slice().sort((a,b)=>compareScore(a.score,b.score))[0];
        best = { sheetIndex, freeIndex: 0, x: free.x, y: free.y, ...option };
      }
      const sheet = sheets[best.sheetIndex];
      const free = sheet.free.splice(best.freeIndex, 1)[0];
      const placed = {
        rowId: item.rowId, unit: item.unit, rowQty: item.rowQty,
        length: item.length, width: item.width,
        x: free.x, y: free.y, w: best.w, h: best.h, rotated: best.rotated,
        sourceEdgeBanding: normalizeBanding(item.edgeBanding),
        edgeBanding: edgeMap(item.edgeBanding, best.rotated),
        edgeBandingSpec: normalizeEdgeBandingSpec(item.edgeBandingSpec)
      };
      sheet.placed.push(placed);
      placeInTree(sheet, free, best, placed, cfg);
    }
    return sheets;
  }
  function sameNumber(a, b) { return Math.abs(Number(a) - Number(b)) <= EPS; }
  function sameRegion(a, b) { return a && b && ['x','y','w','h'].every(k => sameNumber(a[k], b[k])); }
  function validateTree(sheet, cfg, expectedByKey, found, treeCuts, freeLeaves) {
    const rootRegion = { x: cfg.margin, y: cfg.margin, w: cfg.usableW, h: cfg.usableH };
    if (!sheet.cutTree) throw new Error('Guillotine validation: missing hierarchical cut tree.');
    function walk(node, expectedRegion) {
      if (!node || !sameRegion(node.region, expectedRegion)) throw new Error('Guillotine validation: child region does not match its parent split.');
      const r = node.region;
      if (node.type === 'leaf') {
        if (node.children && node.children.length) throw new Error('Guillotine validation: terminal leaf has child nodes.');
        if (node.part) {
          const part = node.part, key = `${part.rowId}|${part.unit}`, expected = expectedByKey.get(key);
          if (!expected || found.has(key)) throw new Error(`Guillotine validation: unknown or duplicate piece ${key}.`);
          if (!sameNumber(part.x,r.x) || !sameNumber(part.y,r.y) || part.w > r.w + EPS || part.h > r.h + EPS || part.w <= 0 || part.h <= 0) {
            throw new Error(`Guillotine validation: piece ${key} is not contained in its terminal cut region.`);
          }
          const expectedW = part.rotated ? expected.width : expected.length;
          const expectedH = part.rotated ? expected.length : expected.width;
          if (part.rotated && !expected.rotate) throw new Error(`Guillotine validation: piece ${key} was rotated although rotation is disabled.`);
          if (!sameNumber(part.w, expectedW) || !sameNumber(part.h, expectedH)) throw new Error(`Guillotine validation: piece ${key} has incorrect dimensions.`);
          found.add(key);
        } else freeLeaves.push(node);
        return;
      }
      if (node.type !== 'cut' || !node.cut || !Array.isArray(node.children) || node.children.length !== 2) throw new Error('Guillotine validation: malformed cut-tree node.');
      const cut = node.cut, a = node.children[0].region, b = node.children[1].region;
      if (!sameNumber(cut.kerf, cfg.kerf)) throw new Error('Guillotine validation: cut kerf does not match the job setting.');
      if (cut.axis === 'vertical') {
        if (!sameNumber(a.x,r.x) || !sameNumber(a.y,r.y) || !sameNumber(a.h,r.h) ||
            !sameNumber(b.y,r.y) || !sameNumber(b.h,r.h) || !sameNumber(b.x,a.x+a.w+cfg.kerf) ||
            !sameNumber(b.x+b.w,r.x+r.w) || !sameNumber(cut.x,a.x+a.w+cfg.kerf/2) ||
            !sameNumber(cut.y,r.y) || !sameNumber(cut.length,r.h)) {
          throw new Error('Guillotine validation: vertical cut does not create two full-span rectangular children with the specified kerf.');
        }
      } else if (cut.axis === 'horizontal') {
        if (!sameNumber(a.x,r.x) || !sameNumber(a.y,r.y) || !sameNumber(a.w,r.w) ||
            !sameNumber(b.x,r.x) || !sameNumber(b.w,r.w) || !sameNumber(b.y,a.y+a.h+cfg.kerf) ||
            !sameNumber(b.y+b.h,r.y+r.h) || !sameNumber(cut.y,a.y+a.h+cfg.kerf/2) ||
            !sameNumber(cut.x,r.x) || !sameNumber(cut.length,r.w)) {
          throw new Error('Guillotine validation: horizontal cut does not create two full-span rectangular children with the specified kerf.');
        }
      } else throw new Error('Guillotine validation: unknown cut direction.');
      treeCuts.push(cut);
      walk(node.children[0], a); walk(node.children[1], b);
    }
    walk(sheet.cutTree, rootRegion);
    if (treeCuts.length !== sheet.cuts.length) throw new Error('Guillotine validation: cut record count differs from hierarchical cut tree.');
    treeCuts.sort((a,b)=>a.sequence-b.sequence);
    for (let i=0;i<treeCuts.length;i++) {
      const a=treeCuts[i], b=sheet.cuts[i];
      if (a !== b || a.sequence !== i+1) throw new Error('Guillotine validation: cut sequence does not match the hierarchical cut tree.');
    }
    if (freeLeaves.length !== sheet.free.length) throw new Error('Guillotine validation: reusable offcut list differs from terminal cut-tree leaves.');
    for (const f of sheet.free) if (!freeLeaves.some(n=>n===f.node && sameRegion(n.region,f))) throw new Error('Guillotine validation: an offcut is not a terminal child region.');
  }
  function validate(sheets, cfg, expectedItems) {
    const expected = new Map(expectedItems.map(item => [`${item.rowId}|${item.unit}`, item]));
    const found = new Set();
    for (const sheet of sheets) {
      validateTree(sheet, cfg, expected, found, [], []);
      for (let i=0;i<sheet.placed.length;i++) for (let j=i+1;j<sheet.placed.length;j++) {
        const a=sheet.placed[i],b=sheet.placed[j];
        const overlap=a.x < b.x+b.w-EPS && a.x+a.w > b.x+EPS && a.y < b.y+b.h-EPS && a.y+a.h > b.y+EPS;
        if (overlap) throw new Error(`Guillotine validation: row ${a.rowId} overlaps row ${b.rowId}.`);
      }
      const treeParts = new Set();
      (function collect(node) { if (node.type==='leaf' && node.part) treeParts.add(node.part); else (node.children||[]).forEach(collect); })(sheet.cutTree);
      if (treeParts.size !== sheet.placed.length || sheet.placed.some(p=>!treeParts.has(p))) throw new Error('Guillotine validation: placed-part list differs from cut-tree leaves.');
    }
    if (found.size !== expected.size) throw new Error(`Only ${found.size} of ${expected.size} pieces were placed.`);
    for (const key of expected.keys()) if (!found.has(key)) throw new Error(`Guillotine validation: requested piece ${key} is missing.`);
    return found.size;
  }
  function collectLeaves(node, output=[]) {
    if (node.type==='leaf') output.push(node);
    else (node.children||[]).forEach(child=>collectLeaves(child,output));
    return output;
  }
  function candidateQuality(sheets) {
    let freeRegions=0,cutLength=0,reusableOffcutArea=0,thinOffcutArea=0;
    for (const sheet of sheets) {
      freeRegions += sheet.free.length;
      for (const cut of sheet.cuts) cutLength += cut.length;
      for (const free of sheet.free) {
        const area=free.w*free.h, short=Math.min(free.w,free.h);
        if (short>=REUSABLE_MIN_SIDE && area>=REUSABLE_MIN_AREA) reusableOffcutArea += area;
        else thinOffcutArea += area;
      }
    }
    return { freeRegions, cutLength, reusableOffcutArea, thinOffcutArea,
      unusableWasteArea: thinOffcutArea };
  }
  function isBetter(candidate,best) {
    if (!best) return true;
    if (candidate.sheets.length !== best.sheets.length) return candidate.sheets.length < best.sheets.length;
    if (Math.abs(candidate.quality.unusableWasteArea-best.quality.unusableWasteArea)>EPS) return candidate.quality.unusableWasteArea<best.quality.unusableWasteArea;
    if (Math.abs(candidate.quality.reusableOffcutArea-best.quality.reusableOffcutArea)>EPS) return candidate.quality.reusableOffcutArea>best.quality.reusableOffcutArea;
    if (candidate.quality.cutLength !== best.quality.cutLength) return candidate.quality.cutLength<best.quality.cutLength;
    return candidate.quality.freeRegions<best.quality.freeRegions;
  }
  function prepare(rows, options) {
    const sheetLength=numberValue(options.sheetLength,'Sheet length',1), sheetWidth=numberValue(options.sheetWidth,'Sheet width',1);
    const kerf=numberValue(options.kerf??0,'Kerf',0), margin=numberValue(options.margin??0,'Edge margin',0);
    if (2*margin>=Math.min(sheetLength,sheetWidth)) throw new Error('Edge margin is too large.');
    const mode=options.cutMode||'optimum';
    if (!['width','length','optimum'].includes(mode)) throw new Error('Choose Cut along width, Cut along length or Optimal.');
    const items=expandRows(rows), seed=Number.isInteger(Number(options.seed))?Number(options.seed)>>>0:20261109;
    const cfg={sheetLength,sheetWidth,kerf,margin,usableW:sheetLength-2*margin,usableH:sheetWidth-2*margin};
    for(const item of items){
      const fits=(w,h)=>w<=cfg.usableW+EPS&&h<=cfg.usableH+EPS;
      if(!fits(item.length,item.width)&&(!item.rotate||!fits(item.width,item.length)))
        throw new Error(`Row ${item.rowId} (${item.length} × ${item.width} mm) cannot fit on the usable sheet in an allowed orientation.`);
    }
    return { rows, items, mode, seed, cfg, effort:SEARCH_STARTS[options.effort]?options.effort:'standard' };
  }
  function makeResult(best, context, metrics) {
    const {rows,items,mode,seed,cfg}=context;
    const pieces=validate(best.sheets,cfg,items);
    const partArea=items.reduce((sum,item)=>sum+item.area,0);
    const edgeBandingTotalsMm=items.reduce((totals,item)=>{
      const spec=item.edgeBandingSpec;
      totals['0.8']+=item.length*spec['0.8'].length+item.width*spec['0.8'].width;
      totals['2']+=item.length*spec['2'].length+item.width*spec['2'].width; return totals;
    },{'0.8':0,'2':0});
    const grossSheetArea=cfg.sheetLength*cfg.sheetWidth*best.sheets.length;
    const usedBoardIds=new Set();
    for (const sheet of best.sheets) {
      const signature=sheet.placed.map(p=>`${p.rowId}|${p.unit}`).sort().join(';');
      const baseId=`board-${hashText(signature).toString(36)}-${hashText(signature.split('').reverse().join('')).toString(36)}`;
      let id=baseId,suffix=1;while(usedBoardIds.has(id))id=`${baseId}-${suffix++}`;
      usedBoardIds.add(id);sheet.id=id;
    }
    const stats={...metrics, reusableOffcutArea:best.quality.reusableOffcutArea,
      unusableWasteArea:Math.max(0,grossSheetArea-partArea-best.quality.reusableOffcutArea)};
    return { sheets:best.sheets,sheetLength:cfg.sheetLength,sheetWidth:cfg.sheetWidth,kerf:cfg.kerf,margin:cfg.margin,
      rows:rows.length,pieces,partArea,grossSheetArea,wasteArea:grossSheetArea-partArea,edgeBandingTotalsMm,
      utilization:partArea/grossSheetArea*100,attempts:metrics.candidatesEvaluated,validAttempts:metrics.validCandidates,
      candidatesEvaluated:metrics.candidatesEvaluated,validCandidates:metrics.validCandidates,improvements:metrics.improvements,
      searchDurationMs:metrics.searchDurationMs,seed,winningStrategy:`${best.strategy.order}/${best.strategy.scoreType}${best.strategy.reverse?'/reverse':''}`,
      ordering:best.strategy.order,cutMode:mode,stopReason:metrics.stopReason,reusableOffcutArea:stats.reusableOffcutArea,
      unusableWasteArea:stats.unusableWasteArea,cutLength:best.quality.cutLength,freeRegions:best.quality.freeRegions,
      validated:true,guillotine:true,heuristic:true};
  }
  function createMetrics(started) { return {candidatesEvaluated:0,validCandidates:0,improvements:0,searchDurationMs:0,stopReason:'',started}; }
  function tryCandidate(context,strategy,maxSheets=Infinity) {
    const sheets=pack(context.items,context.cfg,strategy,context.mode,maxSheets);
    validate(sheets,context.cfg,context.items);
    return {sheets,strategy,quality:candidateQuality(sheets)};
  }
  function finalizeMetrics(metrics, stopReason) {
    metrics.searchDurationMs=Math.max(0,Math.round((Date.now()-metrics.started)*100)/100);
    metrics.stopReason=stopReason; delete metrics.started;
  }
  function optimize(rows, options={}) {
    const context=prepare(rows,options), strategies=strategiesFor(context.effort,context.seed);
    const metrics=createMetrics(Date.now()); let best=null;
    for (const strategy of strategies) {
      metrics.candidatesEvaluated++;
      try {
        const candidate=tryCandidate(context,strategy); metrics.validCandidates++;
        if (isBetter(candidate,best)) { best=candidate; metrics.improvements++; }
      } catch (_) { /* infeasible candidates are counted but never accepted */ }
    }
    // A measured final-board-elimination phase. It cannot accept an extra board.
    if (best && best.sheets.length>1) {
      const probes=[
        {order:'difficult',reverse:false,seed:context.seed+901,shuffle:false,scoreType:'offcut'},
        {order:'area',reverse:false,seed:context.seed+902,shuffle:false,scoreType:'waste'},
        {order:'rotation',reverse:true,seed:context.seed+903,shuffle:false,scoreType:'balance'},
        {order:'shuffle',reverse:false,seed:context.seed+904,shuffle:true,scoreType:'offcut'}
      ];
      for (const strategy of probes) {
        metrics.candidatesEvaluated++;
        try {
          const candidate=tryCandidate(context,strategy,best.sheets.length-1); metrics.validCandidates++;
          if (isBetter(candidate,best)) { best=candidate; metrics.improvements++; }
        } catch (_) { /* no board-elimination candidate */ }
      }
    }
    if (!best) throw new Error('No feasible guillotine layout found. Increase the sheet size or verify dimensions and rotation settings.');
    finalizeMetrics(metrics,'Search portfolio and board-elimination probes completed.');
    return makeResult(best,context,metrics);
  }
  async function optimizeAsync(rows, options={}, onProgress=()=>{}) {
    const context=prepare(rows,options), strategies=strategiesFor(context.effort,context.seed);
    const metrics=createMetrics(Date.now()); let best=null;
    const total=strategies.length+(1);
    for (let i=0;i<strategies.length;i++) {
      const strategy=strategies[i]; metrics.candidatesEvaluated++;
      try {
        const candidate=tryCandidate(context,strategy); metrics.validCandidates++;
        if (isBetter(candidate,best)) { best=candidate; metrics.improvements++; }
      } catch (_) { /* infeasible candidate */ }
      if (metrics.validCandidates===1 || (i+1)%2===0 || i===strategies.length-1) {
        const snapshotMetrics={...metrics,searchDurationMs:Math.max(0,Math.round((Date.now()-metrics.started)*100)/100),stopReason:'Search in progress; best validated solution retained.'};
        const bestPlan=best?makeResult(best,context,snapshotMetrics):null;
        onProgress({phase:'portfolio',completed:i+1,total,candidatesEvaluated:metrics.candidatesEvaluated,validCandidates:metrics.validCandidates,
          bestBoards:best?.sheets.length??null,improvements:metrics.improvements,bestPlan});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    if (best && best.sheets.length>1) {
      const probes=[
        {order:'difficult',reverse:false,seed:context.seed+901,shuffle:false,scoreType:'offcut'},
        {order:'area',reverse:false,seed:context.seed+902,shuffle:false,scoreType:'waste'},
        {order:'rotation',reverse:true,seed:context.seed+903,shuffle:false,scoreType:'balance'},
        {order:'shuffle',reverse:false,seed:context.seed+904,shuffle:true,scoreType:'offcut'}
      ];
      for (let i=0;i<probes.length;i++) {
        const strategy=probes[i]; metrics.candidatesEvaluated++;
        try {
          const candidate=tryCandidate(context,strategy,best.sheets.length-1); metrics.validCandidates++;
          if (isBetter(candidate,best)) { best=candidate; metrics.improvements++; }
        } catch (_) { /* board reduction not feasible */ }
        const snapshotMetrics={...metrics,searchDurationMs:Math.max(0,Math.round((Date.now()-metrics.started)*100)/100),stopReason:'Board-reduction probes in progress; best validated solution retained.'};
        onProgress({phase:'board-reduction',completed:i+1,total:probes.length,candidatesEvaluated:metrics.candidatesEvaluated,
          validCandidates:metrics.validCandidates,bestBoards:best.sheets.length,improvements:metrics.improvements,bestPlan:makeResult(best,context,snapshotMetrics)});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    if (!best) throw new Error('No feasible guillotine layout found. Increase the sheet size or verify dimensions and rotation settings.');
    finalizeMetrics(metrics,'Search portfolio and board-elimination probes completed.');
    return makeResult(best,context,metrics);
  }
  return { optimize,optimizeAsync,expandRows,validate,normalizeEdgeBandingSpec,hashText,strategiesFor };
});
