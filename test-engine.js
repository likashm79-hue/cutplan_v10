'use strict';
const assert=require('node:assert/strict');
const Engine=require('./nesting-engine.js');
const Parser=require('./cutting-list-parser.js');

const benchmarkRows=[
  [1,470,300,2],[2,700,300,4],[3,470,290,1],[4,688,490,5],[5,676,65,2],[6,676,180,3],
  [7,220,300,2],[8,220,290,1],[9,776,300,1],[10,300,300,2],[11,470,300,1],[12,300,300,2],
  [13,1012,400,2],[14,350,400,2],[15,877,380,1],[16,877,90,2],[17,800,380,2],[18,877,370,1],
  [19,677,500,2],[20,1306,500,2],[21,717,490,1],[22,860,300,2],[23,565,300,2],[24,677,270,1],
  [25,570,300,2],[26,565,300,2],[27,450,290,1]
].map(([rowId,length,width,qty])=>({rowId:String(rowId),length,width,qty,rotate:true}));
const pieces=benchmarkRows.reduce((sum,row)=>sum+row.qty,0);
assert.equal(pieces,51);

for(const mode of ['width','length','optimum']){
  const plan=Engine.optimize(benchmarkRows,{sheetLength:2440,sheetWidth:1200,kerf:4,margin:1,effort:'quick',cutMode:mode,seed:77});
  assert.equal(plan.cutMode,mode);assert.equal(plan.pieces,pieces);assert.equal(plan.rows,27);
  assert.equal(plan.validated,true);assert.equal(plan.guillotine,true);assert.ok(plan.sheets.length>0);
  assert.equal(plan.candidatesEvaluated,plan.attempts);assert.ok(plan.validCandidates<=plan.candidatesEvaluated);
  const freeBoxes=plan.sheets.reduce((n,s)=>n+s.free.length,0);
  assert.equal(plan.offcutCount,freeBoxes);
  assert.equal(plan.reusableOffcutCount+plan.unusableOffcutCount,plan.offcutCount);
  assert.ok(plan.largestReusableOffcutArea>=0);
  assert.ok(plan.searchDurationMs>=0);assert.equal(plan.seed,77);assert.ok(plan.winningStrategy);
  const seen=new Set();
  for(const sheet of plan.sheets){
    assert.ok(sheet.cutTree);assert.ok(sheet.id.startsWith('board-'));
    for(const part of sheet.placed){const key=`${part.rowId}|${part.unit}`;assert.ok(!seen.has(key));seen.add(key);assert.ok(part.x>=1&&part.y>=1);assert.ok(part.x+part.w<=2439+1e-7);assert.ok(part.y+part.h<=1199+1e-7);}
  }
  assert.equal(seen.size,pieces);
  console.log(`${mode}: ${plan.sheets.length} boards, ${pieces} pieces, ${plan.utilization.toFixed(2)}% use, ${plan.candidatesEvaluated} candidates (${plan.validCandidates} valid), ${plan.searchDurationMs} ms`);
}

const dirRows=[{rowId:'CUT',length:500,width:300,qty:1,rotate:false}];
const widthPlan=Engine.optimize(dirRows,{sheetLength:1200,sheetWidth:800,kerf:4,effort:'quick',cutMode:'width'});
const lengthPlan=Engine.optimize(dirRows,{sheetLength:1200,sheetWidth:800,kerf:4,effort:'quick',cutMode:'length'});
assert.equal(widthPlan.sheets[0].cuts[0].axis,'horizontal');
assert.equal(lengthPlan.sheets[0].cuts[0].axis,'vertical');
console.log('cut direction: width starts horizontal; length starts vertical');
console.log('offcut accounting: every terminal rectangular free region is counted and classified as reusable or small scrap');

const deep=Engine.optimize(benchmarkRows,{sheetLength:2440,sheetWidth:1200,kerf:4,margin:1,effort:'deep',cutMode:'optimum',seed:20261109});
assert.ok(deep.candidatesEvaluated>=192);assert.equal(deep.pieces,pieces);assert.ok(deep.stopReason.includes('completed'));
console.log(`deep search: ${deep.sheets.length} boards, ${deep.candidatesEvaluated} candidates, ${deep.validCandidates} valid, ${deep.improvements} improvements`);

// Seeded runs are reproducible in placement, split tree, and board identity.
const reproducibleA=Engine.optimize(benchmarkRows,{sheetLength:2440,sheetWidth:1200,kerf:4,effort:'quick',seed:12345});
const reproducibleB=Engine.optimize(benchmarkRows,{sheetLength:2440,sheetWidth:1200,kerf:4,effort:'quick',seed:12345});
const signature=p=>p.sheets.map(s=>`${s.id}:${s.placed.map(x=>`${x.rowId}/${x.unit}/${x.x}/${x.y}/${x.rotated}`).join(';')}`).join('|');
assert.equal(signature(reproducibleA),signature(reproducibleB));
console.log('determinism: identical rows, settings and seed reproduce identical layouts and board IDs');

// A fixed hard mixed-orientation case where the deeper portfolio eliminates one stock board.
const improvementRows=[
 {rowId:'T2-1',length:486,width:612,qty:3,rotate:true},{rowId:'T2-2',length:669,width:427,qty:3,rotate:true},
 {rowId:'T2-3',length:313,width:713,qty:2,rotate:true},{rowId:'T2-4',length:447,width:203,qty:2,rotate:false},
 {rowId:'T2-5',length:405,width:159,qty:3,rotate:true},{rowId:'T2-6',length:756,width:244,qty:1,rotate:true},
 {rowId:'T2-7',length:478,width:586,qty:3,rotate:true},{rowId:'T2-8',length:419,width:395,qty:1,rotate:true},
 {rowId:'T2-9',length:294,width:444,qty:2,rotate:false},{rowId:'T2-10',length:730,width:108,qty:2,rotate:true},
 {rowId:'T2-11',length:1149,width:123,qty:3,rotate:true},{rowId:'T2-12',length:468,width:711,qty:3,rotate:true},
 {rowId:'T2-13',length:920,width:294,qty:2,rotate:true},{rowId:'T2-14',length:479,width:177,qty:2,rotate:true},
 {rowId:'T2-15',length:677,width:475,qty:2,rotate:true},{rowId:'T2-16',length:819,width:729,qty:1,rotate:true}
];
const baselineEngine=require('./backup-v0.5.0/nesting-engine.js');
const oldHard=baselineEngine.optimize(improvementRows,{sheetLength:2440,sheetWidth:1220,kerf:3,margin:5,cutMode:'optimum',effort:'max'});
const newHard=Engine.optimize(improvementRows,{sheetLength:2440,sheetWidth:1220,kerf:3,margin:5,cutMode:'optimum',effort:'deep',seed:202601});
assert.equal(oldHard.sheets.length,4);assert.equal(newHard.sheets.length,3);assert.equal(newHard.pieces,35);
assert.ok(newHard.sheets.every(sheet=>sheet.cutTree));
console.log(`measured hard-case improvement: v0.5.0 ${oldHard.sheets.length} boards → v0.6.3 ${newHard.sheets.length}; ${newHard.candidatesEvaluated} candidates, ${newHard.validCandidates} valid, ${newHard.utilization.toFixed(2)}% utilization`);

const rotated=Engine.optimize([{rowId:'A1',length:100,width:50,qty:1,rotate:true,edgeBanding:{top:true,right:false,bottom:true,left:false}}],{sheetLength:50,sheetWidth:100,kerf:0,effort:'quick'});
assert.equal(rotated.sheets[0].placed[0].rotated,true);
assert.deepEqual(rotated.sheets[0].placed[0].edgeBanding,{top:false,right:true,bottom:false,left:true});
const fixed=Engine.optimize([{rowId:'FIX',length:500,width:300,qty:1,rotate:false}],{sheetLength:520,sheetWidth:320,kerf:0,effort:'quick'});
assert.equal(fixed.sheets[0].placed[0].rotated,false);
assert.throws(()=>Engine.optimize([{rowId:'NO',length:500,width:300,qty:1,rotate:false}],{sheetLength:320,sheetWidth:520,kerf:0,effort:'quick'}),/cannot fit/);
console.log('rotation: allowed rotation and fixed orientation enforced; edge mapping retained');

const bandPlan=Engine.optimize([{rowId:'BAND',length:780,width:500,qty:2,rotate:true,edgeBandingSpec:{'0.8':{length:2,width:1},'2':{length:0,width:0}}}],{sheetLength:2000,sheetWidth:1000,kerf:0,effort:'quick'});
assert.equal(bandPlan.edgeBandingTotalsMm['0.8'],4120);assert.equal(bandPlan.edgeBandingTotalsMm['2'],0);
assert.equal(Parser.formatDimensionToken(780,{'0.8':{length:2,width:0},'2':{length:1,width:0}},'length'),'780__~');
console.log('edge banding: 4.12 m of 0.8 mm retained; dimension suffix formatter passed');

const parsed=Parser.parseOcrRows(['Reference | Length | Width | Qty','1 A 780__ 500_ 2','2KB 600~~ 300_ 1','CAB-A1 400 200 1 side length panel','BROKEN 780 -- 2'].join('\n'));
assert.deepEqual(parsed.rows.map(r=>r.rowId),['1A','2KB','CAB-A1']);assert.equal(parsed.rejected,undefined);assert.equal(parsed.ignoredLines.length,2);
const packed=Parser.parseOcrRows('1A 780 500 2 2KB 600 300 1');assert.deepEqual(packed.rows.map(r=>r.rowId),['1A','2KB']);
console.log('parser: alphanumeric refs, edge-band suffixes, packed rows and document-noise filtering passed');

// Tamper with a child rectangle: the independent cut-tree validator must reject it.
const damaged=Engine.optimize(dirRows,{sheetLength:1200,sheetWidth:800,kerf:4,effort:'quick'});
const splitNode=damaged.sheets[0].cutTree;
assert.equal(splitNode.type,'cut');
splitNode.children[1].region.x+=1;
assert.throws(()=>Engine.validate(damaged.sheets,{sheetLength:1200,sheetWidth:800,kerf:4,margin:0,usableW:1200,usableH:800},Engine.expandRows(dirRows)),/child region|vertical cut|horizontal cut/);
console.log('hierarchical validator: malformed child rectangle rejected');

// Difficult, narrow, small, repeated, mixed-orientation and kerf datasets.
const datasets={
  manySmall:Array.from({length:18},(_,i)=>({rowId:`S${i+1}`,length:95+(i%5)*13,width:55+(i%4)*11,qty:5,rotate:true})),
  narrow:Array.from({length:15},(_,i)=>({rowId:`N${i+1}`,length:700+(i%4)*120,width:35+(i%3)*12,qty:2,rotate:i%2===0})),
  mixed:Array.from({length:20},(_,i)=>({rowId:`M${i+1}`,length:180+(i*137)%900,width:100+(i*73)%520,qty:1+(i%3),rotate:i%4!==0})),
  rotationDisabled:Array.from({length:12},(_,i)=>({rowId:`F${i+1}`,length:400+(i%3)*170,width:180+(i%4)*75,qty:2,rotate:false})),
  repeated:Array.from({length:8},(_,i)=>({rowId:`R${i+1}`,length:[400,600,800,300,450,700,500,350][i],width:[300,400,500,200,350,450,250,300][i],qty:20,rotate:true})),
  guillotineHard:[{rowId:'G1',length:1180,width:590,qty:2,rotate:true},{rowId:'G2',length:1160,width:570,qty:2,rotate:true},{rowId:'G3',length:580,width:380,qty:5,rotate:true},{rowId:'G4',length:400,width:260,qty:6,rotate:true},{rowId:'G5',length:90,width:1180,qty:2,rotate:true}]
};
for(const [name,rows] of Object.entries(datasets)){
  const plan=Engine.optimize(rows,{sheetLength:2440,sheetWidth:1220,kerf:4,margin:5,effort:'quick',cutMode:'optimum',seed:900+name.length});
  assert.equal(plan.pieces,rows.reduce((n,r)=>n+r.qty,0));assert.equal(plan.validated,true);
  const expanded=Engine.expandRows(rows);
  for(const sheet of plan.sheets){const ids=new Set(sheet.placed.map(p=>`${p.rowId}|${p.unit}`));Engine.validate([sheet],{sheetLength:2440,sheetWidth:1220,kerf:4,margin:5,usableW:2430,usableH:1210},expanded.filter(item=>ids.has(`${item.rowId}|${item.unit}`)));}
  console.log(`dataset ${name}: ${plan.sheets.length} boards, ${plan.pieces} pieces, ${plan.utilization.toFixed(2)}%, ${plan.reusableOffcutArea.toFixed(0)} mm² reusable offcuts`);
}
for(const kerf of [0,2,4,6]){
  const plan=Engine.optimize([{rowId:'K1',length:800,width:400,qty:3,rotate:true},{rowId:'K2',length:400,width:300,qty:4,rotate:true}],{sheetLength:2440,sheetWidth:1220,kerf,effort:'quick',seed:kerf+1});
  assert.equal(plan.pieces,7);assert.equal(plan.kerf,kerf);console.log(`kerf ${kerf} mm: ${plan.sheets.length} boards, ${plan.validCandidates} valid candidates`);
}

(async()=>{
  let progress=0;
  const asyncPlan=await Engine.optimizeAsync(dirRows,{sheetLength:1200,sheetWidth:800,kerf:4,effort:'quick'},p=>{progress++;if(p.bestPlan)assert.equal(p.bestPlan.validated,true);});
  assert.ok(progress>0);assert.equal(asyncPlan.pieces,1);
  console.log(`worker-compatible async optimizer: ${progress} progress updates; best valid candidate retained through completion`);
  console.log('All CutPlan v1.0.0 core engine regression tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
