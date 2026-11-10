'use strict';
const Old=require('./backup-v0.5.0/nesting-engine.js');
const New=require('./nesting-engine.js');
const base=[
[1,470,300,2],[2,700,300,4],[3,470,290,1],[4,688,490,5],[5,676,65,2],[6,676,180,3],[7,220,300,2],[8,220,290,1],[9,776,300,1],[10,300,300,2],[11,470,300,1],[12,300,300,2],[13,1012,400,2],[14,350,400,2],[15,877,380,1],[16,877,90,2],[17,800,380,2],[18,877,370,1],[19,677,500,2],[20,1306,500,2],[21,717,490,1],[22,860,300,2],[23,565,300,2],[24,677,270,1],[25,570,300,2],[26,565,300,2],[27,450,290,1]
].map(([rowId,length,width,qty])=>({rowId:String(rowId),length,width,qty,rotate:true}));
const data={
  reference51:base,
  manySmall:Array.from({length:18},(_,i)=>({rowId:`S${i+1}`,length:95+(i%5)*13,width:55+(i%4)*11,qty:5,rotate:true})),
  narrow:Array.from({length:15},(_,i)=>({rowId:`N${i+1}`,length:700+(i%4)*120,width:35+(i%3)*12,qty:2,rotate:i%2===0})),
  mixed:Array.from({length:20},(_,i)=>({rowId:`M${i+1}`,length:180+(i*137)%900,width:100+(i*73)%520,qty:1+(i%3),rotate:i%4!==0})),
  fixedRotation:Array.from({length:12},(_,i)=>({rowId:`F${i+1}`,length:400+(i%3)*170,width:180+(i%4)*75,qty:2,rotate:false})),
  repeated160:Array.from({length:8},(_,i)=>({rowId:`R${i+1}`,length:[400,600,800,300,450,700,500,350][i],width:[300,400,500,200,350,450,250,300][i],qty:20,rotate:true})),
  difficultGuillotine:[{rowId:'G1',length:1180,width:590,qty:2,rotate:true},{rowId:'G2',length:1160,width:570,qty:2,rotate:true},{rowId:'G3',length:580,width:380,qty:5,rotate:true},{rowId:'G4',length:400,width:260,qty:6,rotate:true},{rowId:'G5',length:90,width:1180,qty:2,rotate:true}],
  hard35:[{rowId:'T2-1',length:486,width:612,qty:3,rotate:true},{rowId:'T2-2',length:669,width:427,qty:3,rotate:true},{rowId:'T2-3',length:313,width:713,qty:2,rotate:true},{rowId:'T2-4',length:447,width:203,qty:2,rotate:false},{rowId:'T2-5',length:405,width:159,qty:3,rotate:true},{rowId:'T2-6',length:756,width:244,qty:1,rotate:true},{rowId:'T2-7',length:478,width:586,qty:3,rotate:true},{rowId:'T2-8',length:419,width:395,qty:1,rotate:true},{rowId:'T2-9',length:294,width:444,qty:2,rotate:false},{rowId:'T2-10',length:730,width:108,qty:2,rotate:true},{rowId:'T2-11',length:1149,width:123,qty:3,rotate:true},{rowId:'T2-12',length:468,width:711,qty:3,rotate:true},{rowId:'T2-13',length:920,width:294,qty:2,rotate:true},{rowId:'T2-14',length:479,width:177,qty:2,rotate:true},{rowId:'T2-15',length:677,width:475,qty:2,rotate:true},{rowId:'T2-16',length:819,width:729,qty:1,rotate:true}]
};
const fmt=n=>Number(n).toFixed(2);
console.log('dataset,engine,boards,pieces,utilization_pct,waste_m2,reusable_offcut_m2,runtime_ms,candidates,valid_candidates,guillotine_validation');
for(const [name,rows] of Object.entries(data)){
  const opt={sheetLength:2440,sheetWidth:1220,kerf:name==='hard35'?3:4,margin:5,cutMode:'optimum'};
  for(const [label,engine,effort] of [['v0.5.0',Old,'max'],['v0.6.3',New,'deep']]){
    const start=Date.now();
    try{
      const plan=engine.optimize(rows,{...opt,effort,seed:name==='hard35'?202601:20261109});
      const runtime=Date.now()-start;
      const reusable=plan.reusableOffcutArea==null?'not-measured':fmt(plan.reusableOffcutArea/1e6);
      console.log([name,label,plan.sheets.length,plan.pieces,fmt(plan.utilization),fmt(plan.wasteArea/1e6),reusable,runtime,plan.candidatesEvaluated??plan.attempts,plan.validCandidates??plan.validAttempts,label!=='v0.5.0'?'hierarchical tree':'legacy cut-line checks only'].join(','));
    }catch(e){console.log([name,label,'FAIL','', '', '', '',Date.now()-start,'','',''].join(',')+` # ${String(e.message).replace(/,/g,';')}`);}
  }
}
