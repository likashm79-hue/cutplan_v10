/* CutPlan cutting-list parser: preserves alphanumeric references and edge-band symbols.
 * v0.4.4 keeps every data-like source line visible: accepted rows are returned in
 * `rows`; lines that need human review are returned in `rejected` with editable
 * candidate values rather than being silently discarded.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CutPlanParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function emptyEdgeBandingSpec() {
    return { '0.8': { length: 0, width: 0 }, '2': { length: 0, width: 0 } };
  }

  function parseDimensionToken(value) {
    const token = String(value ?? '').trim().replace(/,/g, '.').replace(/\s*mm$/i, '');
    const match = token.match(/^(\d+(?:\.\d+)?)([_~]*)$/);
    if (!match) return null;
    const suffix = match[2] || '';
    return {
      value: Number(match[1]),
      underscoreCount: (suffix.match(/_/g) || []).length,
      tildeCount: (suffix.match(/~/g) || []).length
    };
  }

  function formatDimensionToken(value, spec, axis) {
    const numeric = Number(value);
    const base = Number.isInteger(numeric) ? String(numeric) : String(numeric);
    const bands = spec || emptyEdgeBandingSpec();
    const count08 = Math.max(0, Math.floor(Number(bands['0.8']?.[axis]) || 0));
    const count2 = Math.max(0, Math.floor(Number(bands['2']?.[axis]) || 0));
    return base + '_'.repeat(Math.min(count08, 8)) + '~'.repeat(Math.min(count2, 8));
  }

  function normalizeSpec(lengthParsed, widthParsed) {
    const spec = emptyEdgeBandingSpec();
    if (lengthParsed) {
      spec['0.8'].length = lengthParsed.underscoreCount;
      spec['2'].length = lengthParsed.tildeCount;
    }
    if (widthParsed) {
      spec['0.8'].width = widthParsed.underscoreCount;
      spec['2'].width = widthParsed.tildeCount;
    }
    return spec;
  }

  function tokensForLine(line) {
    // Do not split letters/digits inside references such as 1A, 2KB, CAB-A1 or B_02.
    // Delimiters between table columns are treated as whitespace.
    const source = String(line)
      .replace(/[|\t;]/g, ' ')
      .replace(/\s*[×x]\s*/gi, ' ')
      .replace(/\s+by\s+/gi, ' ');
    const tokens = source.match(/\d+[A-Za-z][A-Za-z0-9._-]*|[A-Za-z][A-Za-z0-9._-]*|\d+(?:[.,]\d+)?[_~]*|[_~]+/g) || [];
    const merged = [];
    for (let i = 0; i < tokens.length; i++) {
      let token = tokens[i];
      // OCR can separate edge markers from their dimension (e.g. `780 __`).
      if (/^\d+(?:[.,]\d+)?$/.test(token) && /^[_~]+$/.test(tokens[i + 1] || '')) {
        token += tokens[++i];
      }
      merged.push(token.replace(/^#/, ''));
    }
    return merged;
  }

  function isDimensionToken(token) {
    return /^\d+(?:[.,]\d+)?[_~]*$/i.test(token || '');
  }

  function isHeaderLine(line, dimensionsFound) {
    if (dimensionsFound >= 2) return false;
    const s = String(line || '').trim();
    if (!s) return true;
    return /^(?:cutting\s*list|all\s+dimensions|reference|ref\.?|part\s*(?:no\.?|number)?|item\s*(?:no\.?|number)?|length|len|width|wid|qty|quantity|rotation|rotate|description|s\.?\s*no\.?)(?:\b|\s|[:|,])/i.test(s) ||
      /^(?:length|len)\s*[|,\t ]+\s*(?:width|wid)\s*[|,\t ]+\s*(?:qty|quantity)/i.test(s);
  }

  function candidateFromTokens(tokens, lineNumber, outputLength) {
    let rowId = '';
    let prefixCount = 0;
    const first = tokens[0] || '';
    const second = tokens[1] || '';
    const dimensions = [];
    const dimensionIndexes = [];

    if (/[A-Za-z]/.test(first)) {
      rowId = first;
      prefixCount = 1;
    } else if (/^\d+$/.test(first) && /^[A-Za-z]+[A-Za-z0-9._-]*$/.test(second)) {
      rowId = first + second;
      prefixCount = 2;
    } else if (/^\d+$/.test(first) && tokens.filter(isDimensionToken).length >= 4) {
      rowId = first;
      prefixCount = 1;
    }

    const valueTokens = tokens.slice(prefixCount);
    for (let i = 0; i < valueTokens.length; i++) {
      if (!isDimensionToken(valueTokens[i])) continue;
      const parsed = parseDimensionToken(valueTokens[i]);
      if (parsed && parsed.value > 0) {
        dimensions.push(parsed);
        dimensionIndexes.push(i);
      }
      if (dimensions.length === 2) break;
    }

    // A candidate reference is retained when identifiable; otherwise suggest a
    // stable sequence number that the user can edit in the unresolved-row table.
    if (!rowId) rowId = String(outputLength + 1);
    const afterWidth = dimensions.length === 2 ? valueTokens.slice(dimensionIndexes[1] + 1) : [];
    const quantityToken = afterWidth.find(token => /^\d+$/.test(token));
    const qty = quantityToken ? Number(quantityToken) : ''; 
    const length = dimensions[0]?.value ?? '';
    const width = dimensions[1]?.value ?? '';
    const lengthParsed = dimensions[0] || null;
    const widthParsed = dimensions[1] || null;
    return {
      rowId, length, width, qty,
      rotate: !/\b(no|false|fixed|cannot)\b/i.test(tokens.join(' ')),
      edgeBandingSpec: normalizeSpec(lengthParsed, widthParsed)
    };
  }

  function candidateIsComplete(tokens, outputLength = 0) {
    const candidate = candidateFromTokens(tokens, 1, outputLength);
    return Number(candidate.length) >= 1 && Number(candidate.width) >= 1 &&
      Number.isInteger(Number(candidate.qty)) && Number(candidate.qty) >= 1 && Number(candidate.qty) <= 10000 &&
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(candidate.rowId));
  }

  function isLikelyPackedRowStart(tokens, index) {
    const token = tokens[index] || '';
    if (/^\d+[A-Za-z][A-Za-z0-9._-]*$/.test(token)) return true;
    if (/^[A-Za-z][A-Za-z0-9._-]*$/.test(token) && /\d/.test(token)) return true;
    if (/^[A-Z][A-Z0-9._-]*$/.test(token) && token.length <= 12) return true;
    if (/^\d+$/.test(token) && /^[A-Za-z]+[A-Za-z0-9._-]*$/.test(tokens[index + 1] || '')) return true;
    // Numeric-only references commonly look like: 12 780 500 2.
    return /^\d+$/.test(token) && tokens.slice(index).filter(isDimensionToken).length >= 3;
  }

  function splitPackedRecords(tokens) {
    if (tokens.length < 6) return [tokens];
    // When a PDF flattens a table into one numeric-only line, detect the two
    // common shapes: [length,width,qty] repeated, or [numeric-ref,length,width,qty].
    if (tokens.every(token => /^\d+(?:[.,]\d+)?$/.test(token))) {
      const firstValue = Number(String(tokens[0]).replace(',', '.'));
      if (tokens.length >= 8 && tokens.length % 4 === 0 && firstValue <= 100) {
        const groups = [];
        for (let i = 0; i < tokens.length; i += 4) groups.push(tokens.slice(i, i + 4));
        const plausibleNumericRefs = groups.every(group => Number(group[1]) >= 10 && Number(group[2]) >= 10 && Number.isInteger(Number(group[3])) && Number(group[3]) >= 1);
        if (plausibleNumericRefs) return groups;
      }
      if (tokens.length % 3 === 0) {
        const groups = [];
        for (let i = 0; i < tokens.length; i += 3) groups.push(tokens.slice(i, i + 3));
        return groups;
      }
    }
    const segments = [];
    let start = 0;
    for (let index = 1; index <= tokens.length - 3; index++) {
      const previous = tokens.slice(start, index);
      const following = tokens.slice(index);
      if (!candidateIsComplete(previous)) continue;
      if (!isLikelyPackedRowStart(tokens, index)) continue;
      if (!candidateIsComplete(following)) continue;
      segments.push(previous);
      start = index;
      index = start;
    }
    segments.push(tokens.slice(start));
    return segments;
  }

  function parseOcrRows(text) {
    const output = [];
    const rejected = [];
    const seen = new Set();
    const sourceLines = String(text || '').split(/\r?\n/);

    sourceLines.forEach((raw, index) => {
      const line = raw.trim();
      if (!line) return;
      const tokens = tokensForLine(line);
      const dimensionCount = tokens.filter(isDimensionToken).length;
      if (isHeaderLine(line, dimensionCount)) return;
      // Ignore ordinary prose with no numeric content. Any number-containing
      // non-header line is retained for review if it cannot become a row.
      if (!/\d/.test(line)) return;

      const segments = splitPackedRecords(tokens);
      segments.forEach((segment, segmentIndex) => {
        const displayLine = segments.length > 1 ? segment.join(' ') : line;
        const segmentDimensionCount = segment.filter(isDimensionToken).length;
        const candidate = candidateFromTokens(segment, index + 1, output.length + rejected.length);
        let reason = '';
        const validDimensions = Number(candidate.length) >= 1 && Number(candidate.width) >= 1;
        const validQty = Number.isInteger(Number(candidate.qty)) && Number(candidate.qty) >= 1 && Number(candidate.qty) <= 10000;
        const validRef = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(candidate.rowId));
        const key = String(candidate.rowId).toLowerCase();

        if (segmentDimensionCount < 2 || !validDimensions) reason = 'Could not confidently identify both dimensions.';
        else if (!validQty) reason = 'Could not identify a valid whole-number quantity after the dimensions.';
        else if (!validRef) reason = 'The reference contains unsupported characters.';
        else if (seen.has(key)) reason = `Duplicate reference: ${candidate.rowId}. Edit the reference if this is a separate part.`;

        if (reason) {
          rejected.push({ line: displayLine, originalLine: line, lineNumber: index + 1, reason, candidate });
          return;
        }

        const length = Number(candidate.length);
        const width = Number(candidate.width);
        const qty = Number(candidate.qty);
        if (length > 100000 || width > 100000) {
          rejected.push({ line: displayLine, originalLine: line, lineNumber: index + 1, reason: 'Dimension is outside the supported range (1–100000 mm).', candidate });
          return;
        }

        seen.add(key);
        output.push({
          rowId: String(candidate.rowId), length, width, qty,
          rotate: !!candidate.rotate,
          edgeBanding: { top: false, right: false, bottom: false, left: false },
          edgeBandingSpec: candidate.edgeBandingSpec,
          sourceLine: index + 1,
          sourceSegment: segments.length > 1 ? segmentIndex + 1 : 1
        });
      });
    });

    return { rows: output, rejected };
  }

  return { emptyEdgeBandingSpec, parseDimensionToken, formatDimensionToken, parseOcrRows, tokensForLine };
});
