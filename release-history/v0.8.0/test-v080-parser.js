'use strict';
const assert = require('node:assert/strict');
const parser = require('./cutting-list-parser.js');

const source = [];
for (let page = 0; page < 12; page++) {
  for (let row = 0; row < 8; row++) {
    const id = page * 8 + row + 1;
    source.push(`P${String(id).padStart(3, '0')} ${500 + id}__ x ${300 + id}_ = 2`);
  }
}
source.push('HIGH-11 700 x 450 = 11');
source.push('DEC-LENGTH 700.5 x 400 = 2');
source.push('DEC-WIDTH 700 x 400.25 = 2');
source.push('DEC-ZERO 700.0 x 400 = 2');
source.push('HIGH-DEC 700.5 x 400 = 11');
source.push('P001 600 x 400 = 1');

const result = parser.parseOcrRows(source.join('\n'));
assert.equal(result.rows.length, 96);
assert.equal(result.rejected.length, 6);
assert(result.rows.every(row => Number.isInteger(row.length) && Number.isInteger(row.width) && row.qty >= 1 && row.qty <= 10));
assert(result.rows[0].edgeBandingSpec['0.8'].length === 2);
assert(result.rows[0].edgeBandingSpec['0.8'].width === 1);
assert(result.rejected.some(item => item.reason.includes('Quantity is greater than 10')));
assert(result.rejected.some(item => item.reason.includes('whole-number') && item.reason.includes('greater than 10')));
assert(result.rejected.some(item => item.reason.includes('Duplicate reference')));

const packed = parser.parseOcrRows('A1 600__ x 400_ = 2 B1 700 x 300 = 1');
assert.equal(packed.rows.length, 2, JSON.stringify(packed));
assert.equal(packed.rows[0].rowId, 'A1');
assert.equal(packed.rows[1].rowId, 'B1');

console.log(`CutPlan v0.8.0 parser checks passed: ${result.rows.length} accepted rows; ${result.rejected.length} flagged rows (quantity >10, decimal dimensions including .0, combined high-quantity/decimal errors, duplicate reference); packed same-line rows split correctly.`);
