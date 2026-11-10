const oldEngine=require('./benchmark-fixtures/v0.6.2-nesting-engine.js');
const newEngine=require('./nesting-engine.js');
const datasets={
  reference:[[470,300,2],[700,300,4],[470,290,1],[688,490,5],[676,65,2],[676,180,3],[220,300,2],[220,290,1],[776,300,1],[300,300,2],[470,300,1],[300,300,2],[1012,400,2],[350,400,2],[877,380,1],[877,90,2],[800,380,2],[877,370,1],[677,500,2],[1306,500,2],[717,490,1],[860,300,2],[565,300,2],[677,270,1],[570,300,2],[565,300,2],[450,290,1]].map((r,i)=>({rowId:String(i+1),length:r[0],width:r[1],qty:r[2],rotate:true})),
  manySmall:Array.from({length:18},(_,i)=>({rowId:`S${i+1}`,length:95+(i%5)*13,width:55+(i%4)*11,qty:5,rotate:true})),
  narrow:Array.from({length:15},(_,i)=>({rowId:`N${i+1}`,length:700+(i%4)*120,width:35+(i%3)*12,qty:2,rotate:i%2===0})),
  mixed:Array.from({length:20},(_,i)=>({rowId:`M${i+1}`,length:180+(i*137)%900,width:100+(i*73)%520,qty:1+(i%3),rotate:i%4!==0})),
  rotationDisabled:Array.from({length:12},(_,i)=>({rowId:`F${i+1}`,length:400+(i%3)*170,width:180+(i%4)*75,qty:2,rotate:false})),
  repeated:Array.from({length:8},(_,i)=>({rowId:`R${i+1}`,length:[400,600,800,300,450,700,500,350][i],width:[300,400,500,200,350,450,250,300][i],qty:20,rotate:true})),
  guillotineHard:[{rowId:'G1',length:1180,width:590,qty:2,rotate:true},{rowId:'G2',length:1160,width:570,qty:2,rotate:true},{rowId:'G3',length:580,width:380,qty:5,rotate:true},{rowId:'G4',length:400,width:260,qty:6,rotate:true},{rowId:'G5',length:90,width:1180,qty:2,rotate:true}],
  hardMixed:[{rowId:'T2-1',length:486,width:612,qty:3,rotate:true},{rowId:'T2-2',length:669,width:427,qty:3,rotate:true},{rowId:'T2-3',length:313,width:713,qty:2,rotate:true},{rowId:'T2-4',length:447,width:203,qty:2,rotate:false},{rowId:'T2-5',length:405,width:159,qty:3,rotate:true},{rowId:'T2-6',length:756,width:244,qty:1,rotate:true},{rowId:'T2-7',length:478,width:586,qty:3,rotate:true},{rowId:'T2-8',length:419,width:395,qty:1,rotate:true},{rowId:'T2-9',length:294,width:444,qty:2,rotate:false},{rowId:'T2-10',length:730,width:108,qty:2,rotate:true},{rowId:'T2-11',length:1149,width:123,qty:3,rotate:true},{rowId:'T2-12',length:468,width:711,qty:3,rotate:true},{rowId:'T2-13',length:920,width:294,qty:2,rotate:true},{rowId:'T2-14',length:479,width:177,qty:2,rotate:true},{rowId:'T2-15',length:677,width:475,qty:2,rotate:true},{rowId:'T2-16',length:819,width:729,qty:1,rotate:true}]
};
const effort=process.argv[2]||'deep';
const out=[];
for(const [name,rows] of Object.entries(datasets)){
 const settings={sheetLength:2440,sheetWidth:name==='hardMixed'||name==='guillotineHard'?1220:1200,kerf:4,margin:5,effort,cutMode:'optimum',seed:61110};
 const a=oldEngine.optimize(rows,settings), b=newEngine.optimize(rows,settings);
 const line={dataset:name,pieces:b.pieces,oldBoards:a.sheets.length,newBoards:b.sheets.length,oldUtil:+a.utilization.toFixed(2),newUtil:+b.utilization.toFixed(2),oldReusable:a.reusableOffcutArea,newReusable:b.reusableOffcutArea,oldOffcuts:a.sheets.reduce((n,s)=>n+s.free.length,0),newOffcuts:b.offcutCount,oldScrap:b.sheets?null:null,newScrap:b.unusableOffcutCount,oldCandidates:a.candidatesEvaluated,newCandidates:b.candidatesEvaluated,oldMs:a.searchDurationMs,newMs:b.searchDurationMs};
 line.oldScrap=a.sheets.reduce((n,s)=>n+s.free.filter(f=>Math.min(f.w,f.h)<100||f.w*f.h<10000).length,0);
 out.push(line); console.log(JSON.stringify(line));
}
require('fs').writeFileSync(`COMPARISON-V062-V063-${effort}.json`,JSON.stringify(out,null,2));
