'use strict';
const assert=require('node:assert/strict');
const Drawing=require('./drawing-layout.js');
function measure(text,fontSize){return {width:String(text).length*fontSize*.54,height:fontSize};}
const small=Drawing.layoutPartLabel({reference:'A1',dimensionA:'120 mm',dimensionB:'80 mm',width:55,height:35,printScale:.16,measure});
assert.ok(['inside','callout'].includes(small.type));
if(small.type==='inside')for(const line of small.lines){assert.ok(line.x>=0&&line.x<=55);assert.ok(line.y>=0&&line.y<=35);assert.ok(line.width<=55);assert.ok(line.height<=35);}
const narrow=Drawing.layoutPartLabel({reference:'CAB-A1-VERY-LONG-REFERENCE',dimensionA:'1800 mm',dimensionB:'28 mm',width:28,height:1800,printScale:.12,measure});
assert.equal(narrow.type,'callout');
const longRef=Drawing.layoutPartLabel({reference:'WARDROBE-SIDE-PANEL-LEFT-001',dimensionA:'2200 mm',dimensionB:'600 mm',width:600,height:2200,printScale:.11,measure});
assert.ok(['inside','callout'].includes(longRef.type));
const oriented=Drawing.layoutOrientedPartLabel({reference:'18KB',horizontalDimension:'470 mm',verticalDimension:'1200 mm',width:470,height:1200,printScale:.14,measure,minReadablePt:6,targetPt:10});
assert.equal(oriented.type,'inside');
assert.equal(oriented.lines[1].rotation,0,'width dimension must follow the horizontal edge');
assert.equal(oriented.lines[2].rotation,-90,'length dimension must follow the vertical edge');
for(const line of oriented.lines){
  const rotated=line.rotation===-90;
  const boxW=rotated?line.height:line.width,boxH=rotated?line.width:line.height;
  assert.ok(line.x-boxW/2>=0&&line.x+boxW/2<=470,'oriented label must remain inside part width');
  assert.ok(line.y-boxH/2>=0&&line.y+boxH/2<=1200,'oriented label must remain inside part length');
}
const narrowOriented=Drawing.layoutOrientedPartLabel({reference:'2KB',horizontalDimension:'100 mm',verticalDimension:'700 mm',width:100,height:700,printScale:.14,measure});
assert.ok(['inside','callout'].includes(narrowOriented.type));
const marker=Drawing.fitMarker('⑳',16,25,.13,measure);
assert.ok(marker.width<=16&&marker.height<=25);
const schedule=new Map();
for(let i=0;i<120;i++){
  const ref=`PART-${i+1}-LONG`;
  const result=Drawing.layoutPartLabel({reference:ref,dimensionA:'600 mm',dimensionB:'300 mm',width:65+(i%3)*10,height:34+(i%2)*8,printScale:.13,measure});
  if(result.type==='callout'){
    const id=`${ref}|600 mm|300 mm`;schedule.set(id,{ref,dimensions:['600 mm','300 mm'],marker:`${i+1}`});
    const fitted=Drawing.fitMarker(`${i+1}`,65+(i%3)*10,34+(i%2)*8,.13,measure);
    assert.ok(fitted.x-fitted.width/2>=0&&fitted.x+fitted.width/2<=65+(i%3)*10);
  }else{
    for(const line of result.lines){assert.ok(line.x-line.width/2>=0-1e-6);assert.ok(line.x+line.width/2<=65+(i%3)*10+1e-6);assert.ok(line.y-line.height/2>=0-1e-6);assert.ok(line.y+line.height/2<=34+(i%2)*8+1e-6);}
  }
}
for(const [key,item] of schedule){assert.ok(key.startsWith(item.ref+'|'));assert.equal(item.dimensions[0],'600 mm');assert.equal(item.dimensions[1],'300 mm');}
console.log(`Drawing label tests passed: axis-oriented dimensions, adaptive fit, narrow/long references, marker containment and ${schedule.size} marker-to-schedule mappings.`);
