'use strict';
const assert = require('node:assert/strict');
const parser = require('./cutting-list-parser.js');

// Long multi-page style input: ordering must be preserved across page breaks.
const source = [];
for (let page = 0; page < 12; page++) {
  source.push(`Page ${page + 1} of 12`);
  if (page === 0) source.push('Cutting List', 'Reference | Length | Width | Qty');
  for (let row = 0; row < 8; row++) {
    const id = page * 8 + row + 1;
    source.push(`P${String(id).padStart(3, '0')} ${500 + id}__ x ${300 + id}_ = ${id === 11 ? 11 : 2}`);
  }
  source.push('Grand Total');
}
const result = parser.parseOcrRows(source.join('\n'));
assert.equal(result.rows.length, 96);
assert.deepEqual(result.rows.slice(0, 4).map(r => r.rowId), ['P001', 'P002', 'P003', 'P004']);
assert.deepEqual(result.rows.slice(-4).map(r => r.rowId), ['P093', 'P094', 'P095', 'P096']);
assert.equal(result.rows.find(r => r.rowId === 'P011').qty, 11, 'quantity > 10 must be placed directly into the list');
assert.equal(result.rows[0].edgeBandingSpec['0.8'].length, 2);
assert.equal(result.rows[0].edgeBandingSpec['0.8'].width, 1);
assert.equal(result.rejected, undefined, 'the review queue contract is removed');
assert(result.ignoredLines.length >= 24, 'headers, page numbers and totals are filtered');

// Whole-number output: decimal OCR artifacts are normalized and flagged on-row.
const decimalRows = parser.parseOcrRows([
  'DEC0 700.0 x 400 = 2',
  'DECL 700.5 x 400.25 = 2',
  'HIGH 700 x 450 = 25',
  'NOQTY 600 x 300',
  'EXCESS 700___ x 450~~~~ = 3'
].join('\n')).rows;
assert.equal(decimalRows.length, 5);
assert(decimalRows.every(r => Number.isInteger(r.length) && Number.isInteger(r.width)));
assert.equal(decimalRows[0].length, 700);
assert.equal(decimalRows[1].length, 701);
assert.equal(decimalRows[1].width, 400);
assert(decimalRows[1].parseNotes.length > 0);
assert.equal(decimalRows[2].qty, 25);
assert.equal(decimalRows[3].qty, 1);
assert(decimalRows[3].parseNotes.some(n => n.includes('defaulted to 1')));
assert.equal(decimalRows[4].edgeBandingSpec['0.8'].length, 2);
assert.equal(decimalRows[4].edgeBandingSpec['2'].width, 2);

// Duplicate references remain present in original order with stable unique IDs.
const duplicates = parser.parseOcrRows('A1 600 x 400 = 2\nA1 700 x 300 = 1\nB2 500 x 250 = 1').rows;
assert.deepEqual(duplicates.map(r => r.rowId), ['A1', 'A1-2', 'B2']);
assert.equal(duplicates[1].sourceRef, 'A1');
assert(duplicates[1].parseNotes.some(n => n.includes('Duplicate reference')));

// Rows packed onto one line, numeric-only rows, and rows with no printed reference.
const packed = parser.parseOcrRows('A1 600__ x 400_ = 2 B1 700 x 300 = 1').rows;
assert.deepEqual(packed.map(r => [r.rowId, r.length, r.width, r.qty]), [['A1',600,400,2],['B1',700,300,1]]);
const numeric = parser.parseOcrRows('1 700 100 2 2 600 400 4').rows;
assert.deepEqual(numeric.map(r => [r.rowId, r.length, r.width, r.qty]), [['1',700,100,2],['2',600,400,4]]);
const noRef = parser.parseOcrRows('700 100 2').rows;
assert.equal(noRef.length, 1);
assert.equal(noRef[0].rowId, 'PART-001');

// Common OCR punctuation, spaced edge marks and unwanted lines.
const messy = parser.parseOcrRows([
  '8.KB) 600 __x480__ =2',
  '9.KB) 692 _ x490__ =3',
  '10.KB) 680 __x65__ =2',
  'Page 1 of 1',
  'Board size 2440 x 1220',
  'Grand Total 17',
  'BROKEN 780 -- 2'
].join('\n'));
assert.deepEqual(messy.rows.map(r => r.rowId), ['8.KB','9.KB','10.KB']);
assert.equal(messy.rows[0].width, 480);
assert.equal(messy.rows[1].qty, 3);
assert(messy.ignoredLines.length >= 4);

console.log(`CutPlan v1.0.0 parser tests passed: ${result.rows.length} multi-page rows; high quantities and decimals retained as editable rows; duplicates preserved; packed and numeric rows split; document metadata filtered.`);
