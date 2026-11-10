'use strict';
const assert = require('node:assert/strict');
const CutPlanEngine = require('./nesting-engine.js');
const CutPlanParser = require('./cutting-list-parser.js');

const benchmarkRows = [
  [1,470,300,2],[2,700,300,4],[3,470,290,1],[4,688,490,5],[5,676,65,2],[6,676,180,3],
  [7,220,300,2],[8,220,290,1],[9,776,300,1],[10,300,300,2],[11,470,300,1],[12,300,300,2],
  [13,1012,400,2],[14,350,400,2],[15,877,380,1],[16,877,90,2],[17,800,380,2],[18,877,370,1],
  [19,677,500,2],[20,1306,500,2],[21,717,490,1],[22,860,300,2],[23,565,300,2],[24,677,270,1],
  [25,570,300,2],[26,565,300,2],[27,450,290,1]
].map(([rowId,length,width,qty]) => ({ rowId:String(rowId),length,width,qty,rotate:true }));

const expectedPieces = benchmarkRows.reduce((n,row) => n + row.qty, 0);
assert.equal(benchmarkRows.length, 27);
assert.equal(expectedPieces, 51);

for (const [mode,expectedAttempts] of [['width',12],['length',12],['optimum',12]]) {
  const plan = CutPlanEngine.optimize(benchmarkRows, {
    sheetLength:2440, sheetWidth:1200, kerf:4, margin:1,
    effort:'standard', cutMode:mode
  });
  assert.equal(plan.cutMode, mode);
  assert.equal(plan.pieces, expectedPieces);
  assert.equal(plan.rows, 27);
  assert.equal(plan.attempts, expectedAttempts);
  assert.equal(plan.validated, true);
  assert.equal(plan.guillotine, true);
  assert.ok(plan.sheets.length >= 1);
  assert.ok(plan.utilization > 0 && plan.utilization <= 100);
  const seen = new Set();
  for (const sheet of plan.sheets) {
    for (const part of sheet.placed) {
      const k = `${part.rowId}|${part.unit}`;
      assert.ok(!seen.has(k), `duplicate physical part ${k}`);
      seen.add(k);
      assert.ok(part.x >= 1 && part.y >= 1);
      assert.ok(part.x + part.w <= 2439 + 1e-7);
      assert.ok(part.y + part.h <= 1199 + 1e-7);
    }
    for (let i=0;i<sheet.placed.length;i++) for(let j=i+1;j<sheet.placed.length;j++) {
      const a=sheet.placed[i],b=sheet.placed[j];
      const overlap=a.x < b.x+b.w-1e-7 && a.x+a.w > b.x+1e-7 && a.y < b.y+b.h-1e-7 && a.y+a.h > b.y+1e-7;
      assert.equal(overlap,false,`overlap ${a.rowId} / ${b.rowId}`);
    }
    for (const cut of sheet.cuts) {
      assert.ok(cut.region, 'cut stores its parent rectangular region');
      if (cut.axis==='vertical') {
        assert.ok(cut.y >= cut.region.y-1e-7);
        assert.ok(cut.y+cut.length <= cut.region.y+cut.region.h+1e-7);
      } else {
        assert.ok(cut.x >= cut.region.x-1e-7);
        assert.ok(cut.x+cut.length <= cut.region.x+cut.region.w+1e-7);
      }
    }
  }
  assert.equal(seen.size, expectedPieces);
  console.log(`${mode}: ${plan.sheets.length} boards, ${plan.pieces} pieces, ${plan.utilization.toFixed(2)}% utilization, ${plan.attempts} starts, ${plan.validAttempts} feasible`);
}

// Each fixed mode must use its requested first-cut orientation when both offcuts exist.
const directionRows = [{rowId:'CUT',length:500,width:300,qty:1,rotate:false}];
const widthDirection = CutPlanEngine.optimize(directionRows, {sheetLength:1200,sheetWidth:800,kerf:4,margin:0,effort:'standard',cutMode:'width'});
const lengthDirection = CutPlanEngine.optimize(directionRows, {sheetLength:1200,sheetWidth:800,kerf:4,margin:0,effort:'standard',cutMode:'length'});
assert.equal(widthDirection.sheets[0].cuts[0].axis,'horizontal');
assert.equal(lengthDirection.sheets[0].cuts[0].axis,'vertical');
console.log('cut direction: width mode starts horizontal; length mode starts vertical');

const maxPlan = CutPlanEngine.optimize(benchmarkRows, {
  sheetLength:2440, sheetWidth:1200, kerf:4, margin:1,
  effort:'max', cutMode:'optimum'
});
assert.equal(maxPlan.attempts, 240);
assert.equal(maxPlan.pieces, expectedPieces);
console.log(`max search: ${maxPlan.sheets.length} boards, ${maxPlan.utilization.toFixed(2)}% utilization, ${maxPlan.attempts} starts`);

const bandCheck = CutPlanEngine.expandRows([{rowId:'A1',length:100,width:50,qty:1,rotate:true,edgeBanding:{top:true,right:false,bottom:true,left:false}}])[0];
const rotated = CutPlanEngine.optimize([{rowId:'A1',length:100,width:50,qty:1,rotate:true,edgeBanding:{top:true,right:false,bottom:true,left:false}}], {
  sheetLength:50, sheetWidth:100, kerf:0, margin:0, effort:'standard', cutMode:'optimum'
});
assert.equal(rotated.pieces,1);
const rotatedPart = rotated.sheets[0].placed[0];
assert.equal(rotatedPart.rotated,true);
assert.deepEqual(rotatedPart.sourceEdgeBanding,{top:true,right:false,bottom:true,left:false});
assert.deepEqual(rotatedPart.edgeBanding,{top:false,right:true,bottom:false,left:true});
console.log('edge-band mapping: original edge selection retained and remapped on rotation');

// Dimension suffixes encode how many edges need each edge-banding material.
const parsedList = CutPlanParser.parseOcrRows([
  '1 A 780__ 500_ 2',
  '2KB 600~~ 300_ 3',
  'CAB-A1 400 200 1',
  '4 100_~ 50~~ 1',
  'B_02 300 200 1'
].join('\n'));
assert.equal(parsedList.rejected.length, 0);
assert.deepEqual(parsedList.rows.map(row => row.rowId), ['1A','2KB','CAB-A1','4','B_02']);
assert.deepEqual(parsedList.rows[0].edgeBandingSpec, {
  '0.8': { length: 2, width: 1 }, '2': { length: 0, width: 0 }
});
assert.deepEqual(parsedList.rows[1].edgeBandingSpec, {
  '0.8': { length: 0, width: 1 }, '2': { length: 2, width: 0 }
});
assert.deepEqual(parsedList.rows[2].edgeBandingSpec, {
  '0.8': { length: 0, width: 0 }, '2': { length: 0, width: 0 }
});
assert.deepEqual(parsedList.rows[3].edgeBandingSpec, {
  '0.8': { length: 1, width: 0 }, '2': { length: 1, width: 2 }
});
console.log('cutting-list parser: split alphanumeric refs and repeated _ / ~ markers retained');

const bandPlan = CutPlanEngine.optimize([{
  rowId:'BAND-A', length:780, width:500, qty:2, rotate:true,
  edgeBandingSpec:{'0.8':{length:2,width:1},'2':{length:0,width:0}}
}], {
  sheetLength:2000, sheetWidth:1000, kerf:0, margin:0,
  effort:'standard', cutMode:'optimum'
});
assert.equal(bandPlan.edgeBandingTotalsMm['0.8'], 4120);
assert.equal(bandPlan.edgeBandingTotalsMm['2'], 0);
assert.ok(bandPlan.sheets.flatMap(sheet => sheet.placed).every(part => part.edgeBandingSpec['0.8'].length === 2));
console.log('edge-banding totals: 4.12 m of 0.8 mm, 0.00 m of 2 mm for two specified pieces');

const mixedBandPlan = CutPlanEngine.optimize([{
  rowId:'BAND-B', length:600, width:300, qty:1, rotate:true,
  edgeBandingSpec:{'0.8':{length:0,width:1},'2':{length:2,width:0}}
}], {
  sheetLength:1200, sheetWidth:800, kerf:0, margin:0,
  effort:'standard', cutMode:'optimum'
});
assert.equal(mixedBandPlan.edgeBandingTotalsMm['0.8'], 300);
assert.equal(mixedBandPlan.edgeBandingTotalsMm['2'], 1200);
assert.equal(CutPlanParser.formatDimensionToken(780, {'0.8':{length:2,width:0},'2':{length:1,width:0}}, 'length'), '780__~');
console.log('mixed material totals: 0.30 m of 0.8 mm and 1.20 m of 2 mm; CSV/display suffix formatter passed');

// v0.5.0 parser recovery: valid items keep their exact references, while a
// data-like source line that cannot be parsed is returned for manual repair.
const recoveryParse = CutPlanParser.parseOcrRows([
  'Reference | Length | Width | Qty',
  '1 A 780__ 500_ 2',
  '2KB 600~~ 300_ 1',
  'CAB-A1 400 200 1 side length panel',
  'BROKEN 780 -- 2'
].join('\n'));
assert.deepEqual(recoveryParse.rows.map(row => row.rowId), ['1A','2KB','CAB-A1']);
assert.equal(recoveryParse.rejected.length, 1);
assert.equal(recoveryParse.rejected[0].line, 'BROKEN 780 -- 2');
assert.ok(recoveryParse.rejected[0].reason);
const packedParse = CutPlanParser.parseOcrRows('1A 780 500 2 2KB 600 300 1');
assert.deepEqual(packedParse.rows.map(row => row.rowId), ['1A','2KB']);
assert.equal(packedParse.rows.reduce((sum,row) => sum + row.qty, 0), 3);
const packedNumericParse = CutPlanParser.parseOcrRows('780 500 2 600 300 1');
assert.deepEqual(packedNumericParse.rows.map(row => [row.rowId,row.length,row.width,row.qty]), [['1',780,500,2],['2',600,300,1]]);
const packedNumericRefs = CutPlanParser.parseOcrRows('12 780 500 2 13 600 300 1');
assert.deepEqual(packedNumericRefs.rows.map(row => [row.rowId,row.length,row.width,row.qty]), [['12',780,500,2],['13',600,300,1]]);
console.log('parser recovery: valid alphanumeric rows retained; malformed extracted line surfaced for manual correction; same-line records split');

// Manually edited edge-banding specifications flow through the same engine
// material totals without changing the guillotine packing algorithm.
const manualBandPlan = CutPlanEngine.optimize([{
  rowId:'MANUAL-1', length:780, width:500, qty:2, rotate:true,
  edgeBandingSpec:{'0.8':{length:1,width:0},'2':{length:0,width:2}}
}], {
  sheetLength:2000, sheetWidth:1000, kerf:0, margin:0,
  effort:'standard', cutMode:'optimum'
});
assert.equal(manualBandPlan.edgeBandingTotalsMm['0.8'], 1560);
assert.equal(manualBandPlan.edgeBandingTotalsMm['2'], 2000);
assert.equal(manualBandPlan.pieces, 2);
console.log('manual banding: 1.56 m of 0.8 mm and 2.00 m of 2 mm for two pieces');

console.log('All CutPlan v0.5.0 engine and parser checks passed.');
