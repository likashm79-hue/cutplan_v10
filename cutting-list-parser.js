/* CutPlan v1.0.0 parser.
 * Order-preserving, permissive part-row extraction with noise filtering.
 * Uncertain-but-usable rows are imported into the main cutting list and can
 * be corrected in the guided row editor. No separate review queue exists.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CutPlanParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_DIMENSION = 100000;
  const MAX_QUANTITY = 10000;

  function emptyEdgeBandingSpec() {
    return { '0.8': { length: 0, width: 0 }, '2': { length: 0, width: 0 } };
  }

  function parseDimensionToken(value) {
    const token = String(value ?? '').trim().replace(/\s*mm$/i, '');
    const match = token.match(/^(\d+(?:[.,]\d+)?)([_~]*)$/);
    if (!match) return null;
    const numericText = match[1].replace(',', '.');
    const number = Number(numericText);
    if (!Number.isFinite(number)) return null;
    const suffix = match[2] || '';
    return {
      value: number,
      roundedValue: Math.round(number),
      wholeNumber: Number.isInteger(number),
      raw: token,
      underscoreCount: (suffix.match(/_/g) || []).length,
      tildeCount: (suffix.match(/~/g) || []).length
    };
  }

  function formatDimensionToken(value, spec, axis) {
    const numeric = Number(value);
    const base = Number.isFinite(numeric) ? String(Math.round(numeric)) : '0';
    const bands = spec || emptyEdgeBandingSpec();
    const count08 = Math.max(0, Math.floor(Number(bands['0.8']?.[axis]) || 0));
    const count2 = Math.max(0, Math.floor(Number(bands['2']?.[axis]) || 0));
    return base + '_'.repeat(Math.min(count08, 2)) + '~'.repeat(Math.min(count2, 2));
  }

  function isDimensionToken(token) {
    return /^\d+(?:[.,]\d+)?[_~]*$/i.test(String(token || ''));
  }

  function normalizeLine(line) {
    return String(line ?? '')
      .replace(/[\u00a0\u2007\u202f]/g, ' ')
      .replace(/[–—−]/g, '-')
      .replace(/[×✕＊]/g, ' x ')
      .replace(/(\d)\s+([_~]+)/g, '$1$2')
      .replace(/(\d)([_~]*)\s*[xX]\s*(?=\d)/g, '$1$2 ')
      .replace(/\s+[xX]\s+(?=\d)/g, ' ')
      .replace(/[|;\t]/g, ' ')
      .replace(/\s+by\s+/gi, ' x ')
      .replace(/[=:]/g, ' ')
      .replace(/[()[\]{}]/g, ' ')
      .replace(/[•·▪]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokensForLine(line) {
    const source = normalizeLine(line);
    const pattern = /\d+\.[A-Za-z][A-Za-z0-9._-]*|\d+[A-Za-z][A-Za-z0-9._-]*|[A-Za-z][A-Za-z0-9._-]*|\d+(?:[.,]\d+)?[_~]*|[_~]+/g;
    const tokens = source.match(pattern) || [];
    const merged = [];
    for (let i = 0; i < tokens.length; i++) {
      let token = tokens[i];
      if (/^\d+(?:[.,]\d+)?$/.test(token) && /^[_~]+$/.test(tokens[i + 1] || '')) token += tokens[++i];
      merged.push(token.replace(/[.,;:]$/, ''));
    }
    return merged;
  }

  function isNoiseLine(line) {
    const s = normalizeLine(line).toLowerCase();
    if (!s) return true;
    if (/^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/.test(s)) return true;
    if (/^(?:cutting\s*list|parts?\s*list|all\s+dimensions|dimensions\s+in|reference|ref\.?|part\s*(?:no\.?|number)?|item\s*(?:no\.?|number)?|length|len|width|wid|qty|quantity|rotation|rotate|description|s\.?\s*no\.?)(?:\b|\s|[:|,])/.test(s)) return true;
    if (/^(?:grand\s+)?(?:sub\s*)?total\b|^total\s+(?:qty|quantity|area|pieces?)\b/.test(s)) return true;
    if (/^(?:customer|client|project|job\s*name|date|prepared\s*by|material|thickness|board\s*(?:size|name|no)?|sheet\s*(?:size|name|no)?|remarks?|note|summary)\b/.test(s)) return true;
    return false;
  }

  function countDimensions(tokens) {
    return tokens.filter(isDimensionToken).length;
  }

  function isReferenceToken(token) {
    const value = String(token || '').replace(/^[#]+|[.,:;)]+$/g, '');
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && /[A-Za-z]/.test(value);
  }

  function extractPrefix(tokens) {
    if (!tokens.length) return { rowId: '', start: 0 };
    const first = tokens[0];
    const second = tokens[1] || '';
    if (isReferenceToken(first)) return { rowId: first, start: 1 };
    if (/^\d+$/.test(first) && /^[A-Za-z][A-Za-z0-9._-]*$/.test(second)) {
      return { rowId: `${first}${second}`, start: 2 };
    }
    // Numeric row references are common in printed workshop lists.
    if (/^\d+$/.test(first) && countDimensions(tokens.slice(1)) >= 2 && tokens.length >= 4) {
      const n = Number(first);
      if (n >= 1 && n <= 99999) return { rowId: first, start: 1 };
    }
    return { rowId: '', start: 0 };
  }

  function candidateFromTokens(tokens, sourceLine, generatedIndex) {
    const prefix = extractPrefix(tokens);
    const values = tokens.slice(prefix.start);
    const dimensionTokens = [];
    const dimensionIndexes = [];
    for (let i = 0; i < values.length; i++) {
      if (!isDimensionToken(values[i])) continue;
      const parsed = parseDimensionToken(values[i]);
      if (parsed && parsed.value >= 5) {
        dimensionTokens.push(parsed);
        dimensionIndexes.push(i);
      }
      if (dimensionTokens.length === 2) break;
    }
    if (dimensionTokens.length < 2) return null;

    const afterWidth = values.slice(dimensionIndexes[1] + 1);
    const qtyToken = afterWidth.find(token => /^\d+$/.test(token));
    const explicitQty = qtyToken !== undefined;
    let qty = explicitQty ? Number(qtyToken) : 1;
    const notes = [];

    const rawLength = dimensionTokens[0].value;
    const rawWidth = dimensionTokens[1].value;
    let length = Math.round(rawLength);
    let width = Math.round(rawWidth);
    if (!dimensionTokens[0].wholeNumber) notes.push(`Length token ${dimensionTokens[0].raw} normalized to ${length} mm; verify in Row Editor.`);
    if (!dimensionTokens[1].wholeNumber) notes.push(`Width token ${dimensionTokens[1].raw} normalized to ${width} mm; verify in Row Editor.`);
    if (length > MAX_DIMENSION) { length = MAX_DIMENSION; notes.push(`Length exceeded ${MAX_DIMENSION} mm and was capped; verify in Row Editor.`); }
    if (width > MAX_DIMENSION) { width = MAX_DIMENSION; notes.push(`Width exceeded ${MAX_DIMENSION} mm and was capped; verify in Row Editor.`); }
    if (!explicitQty) notes.push('Quantity was not found; defaulted to 1. Verify in Row Editor.');
    if (!Number.isFinite(qty) || qty < 1) { qty = 1; notes.push('Quantity was unreadable; defaulted to 1. Verify in Row Editor.'); }
    if (qty > MAX_QUANTITY) { qty = MAX_QUANTITY; notes.push(`Quantity exceeded ${MAX_QUANTITY} and was capped; verify in Row Editor.`); }

    const rowId = prefix.rowId || `PART-${String(generatedIndex + 1).padStart(3, '0')}`;
    const normalizeCount = (n, material, axis) => {
      if (n > 2) notes.push(`${material} ${axis} edge markers exceeded two; count was capped at 2. Verify in Row Editor.`);
      return Math.min(2, Math.max(0, Number(n) || 0));
    };
    const edgeBandingSpec = {
      '0.8': {
        length: normalizeCount(dimensionTokens[0].underscoreCount, '0.8 mm', 'length'),
        width: normalizeCount(dimensionTokens[1].underscoreCount, '0.8 mm', 'width')
      },
      '2': {
        length: normalizeCount(dimensionTokens[0].tildeCount, '2 mm', 'length'),
        width: normalizeCount(dimensionTokens[1].tildeCount, '2 mm', 'width')
      }
    };
    const tail = values.slice(dimensionIndexes[1] + 1).join(' ').toLowerCase();
    const rotate = !/(?:\bno\b|\bfalse\b|\bfixed\b|\bcannot\b|\brotation\s*[:=]?\s*0\b)/i.test(tail);
    return {
      rowId: String(rowId), sourceRef: prefix.rowId ? String(prefix.rowId) : '',
      length, width, qty: Math.floor(qty), rotate,
      edgeBanding: { top: false, right: false, bottom: false, left: false },
      edgeBandingSpec,
      sourceLine: sourceLine.number,
      sourceText: sourceLine.text,
      parseNotes: notes
    };
  }

  function hasTwoDimensions(tokens) {
    return countDimensions(tokens) >= 2;
  }

  function isPossibleRowStart(tokens, index) {
    const token = tokens[index] || '';
    if (isReferenceToken(token)) return true;
    // A numeric quantity immediately before a new reference must not be
    // mistaken for a numeric reference (e.g. '... 2 B1 ...').
    return false;
  }

  function splitPackedRecords(tokens) {
    if (tokens.length < 7) return [tokens];

    // Numeric-only copied tables: either Ref/Length/Width/Qty or Length/Width/Qty.
    if (tokens.every(token => /^\d+(?:[.,]\d+)?$/.test(token))) {
      if (tokens.length % 4 === 0 && tokens.length >= 8) {
        const groups = [];
        for (let i = 0; i < tokens.length; i += 4) groups.push(tokens.slice(i, i + 4));
        const plausible = groups.every(g => Number(g[1]) >= 1 && Number(g[1]) <= MAX_DIMENSION && Number(g[2]) >= 1 && Number(g[2]) <= MAX_DIMENSION && Number(g[3]) >= 1);
        if (plausible) return groups;
      }
      if (tokens.length % 3 === 0 && tokens.length >= 6) {
        const groups = [];
        for (let i = 0; i < tokens.length; i += 3) groups.push(tokens.slice(i, i + 3));
        return groups;
      }
    }

    // Repeated references inside a single OCR line are split at each new ref.
    const starts = [];
    for (let i = 1; i < tokens.length - 2; i++) {
      if (!isPossibleRowStart(tokens, i)) continue;
      const previous = tokens.slice(starts.length ? starts[starts.length - 1] : 0, i);
      const following = tokens.slice(i);
      if (hasTwoDimensions(previous) && hasTwoDimensions(following)) starts.push(i);
    }
    if (!starts.length) return [tokens];
    const groups = [];
    let start = 0;
    for (const boundary of starts) { groups.push(tokens.slice(start, boundary)); start = boundary; }
    groups.push(tokens.slice(start));
    return groups.filter(group => group.length);
  }

  function makeUniqueReference(reference, seen) {
    const base = String(reference || 'PART').replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9._-]+/g, '-') || 'PART';
    let next = base;
    let suffix = 2;
    while (seen.has(next.toLowerCase())) next = `${base}-${suffix++}`;
    seen.add(next.toLowerCase());
    return next;
  }

  function parseOcrRows(text) {
    const rows = [];
    const ignoredLines = [];
    const seen = new Set();
    const sourceLines = String(text || '').split(/\r?\n/);
    for (let index = 0; index < sourceLines.length; index++) {
      const raw = sourceLines[index];
      const line = String(raw || '').trim();
      if (!line) continue;
      if (isNoiseLine(line)) { ignoredLines.push({ lineNumber: index + 1, line, reason: 'Header, footer or document metadata.' }); continue; }
      const tokens = tokensForLine(line);
      if (!tokens.length || !/\d/.test(line)) { ignoredLines.push({ lineNumber: index + 1, line, reason: 'No part dimensions found.' }); continue; }
      const segments = splitPackedRecords(tokens);
      let foundAny = false;
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        const segment = segments[segmentIndex];
        if (!hasTwoDimensions(segment)) continue;
        const candidate = candidateFromTokens(segment, { number: index + 1, text: segments.length > 1 ? segment.join(' ') : line }, rows.length);
        if (!candidate) continue;
        foundAny = true;
        const originalRef = candidate.rowId;
        candidate.rowId = makeUniqueReference(originalRef, seen);
        if (candidate.rowId !== originalRef) {
          candidate.parseNotes.push(`Duplicate reference ${originalRef} was renamed to ${candidate.rowId} so no source row is lost.`);
        }
        candidate.sourceSegment = segmentIndex + 1;
        candidate.sourceLineText = line;
        rows.push(candidate);
      }
      if (!foundAny) ignoredLines.push({ lineNumber: index + 1, line, reason: 'No complete pair of dimensions found; not recognized as a part row.' });
    }
    return { rows, ignoredLines, sourceLineCount: sourceLines.length, detectedRowCount: rows.length };
  }

  return { emptyEdgeBandingSpec, parseDimensionToken, formatDimensionToken, parseOcrRows, tokensForLine, normalizeLine };
});
