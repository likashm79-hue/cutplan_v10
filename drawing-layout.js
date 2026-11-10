/* Print-scale-aware part-label fitting shared by the SVG drawing UI and tests. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.CutPlanDrawing=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PT_TO_MM=25.4/72;
  function fallbackMeasure(text,fontSize){
    return {width:String(text).length*fontSize*.54,height:fontSize};
  }
  function layoutPartLabel(options={}){
    const w=Number(options.width)||0,h=Number(options.height)||0;
    const ref=String(options.reference??''),dimA=String(options.dimensionA??''),dimB=String(options.dimensionB??'');
    const scale=Math.max(Number(options.printScale)||0.1,0.0001);
    const measure=typeof options.measure==='function'?options.measure:fallbackMeasure;
    const minPt=Number(options.minReadablePt)||6,targetPt=Number(options.targetPt)||10;
    const patterns=[
      [ref,`${dimA} × ${dimB}`],
      [`${dimA} × ${dimB}`,ref],
      [ref,dimA,dimB],
      [dimA,ref,dimB],
      [dimA,dimB,ref]
    ];
    const padBase=Math.max(.5,Math.min(2,Math.min(w,h)*.08));
    for(let pt=targetPt;pt>=minPt-1e-6;pt-=.5){
      const fontSize=pt*PT_TO_MM/scale;
      for(let pi=0;pi<patterns.length;pi++){
        const lines=patterns[pi];
        const metrics=lines.map(text=>({text,...measure(text,fontSize)}));
        const gap=fontSize*.16;
        const totalHeight=metrics.reduce((sum,m)=>sum+m.height,0)+gap*(metrics.length-1);
        const pad=Math.min(padBase,Math.max(.2,(Math.min(w,h)-totalHeight)*.1));
        if(totalHeight>h-2*pad+1e-6) continue;
        const positions=[
          {anchor:'middle',x:w/2,y:(h-totalHeight)/2},
          {anchor:'middle',x:w*.38,y:(h-totalHeight)/2},
          {anchor:'middle',x:w*.62,y:(h-totalHeight)/2},
          {anchor:'start',x:pad,y:(h-totalHeight)/2},
          {anchor:'end',x:w-pad,y:(h-totalHeight)/2},
          {anchor:'middle',x:w/2,y:pad},
          {anchor:'middle',x:w/2,y:h-pad-totalHeight}
        ];
        for(let oi=0;oi<positions.length;oi++){
          const pos=positions[oi];
          if(metrics.some(m=>m.width>w-2*pad+1e-6)) continue;
          const minX=pos.anchor==='middle'?pos.x-Math.max(...metrics.map(m=>m.width))/2:pos.anchor==='start'?pos.x:pos.x-Math.max(...metrics.map(m=>m.width));
          const maxX=pos.anchor==='middle'?pos.x+Math.max(...metrics.map(m=>m.width))/2:pos.anchor==='start'?pos.x+Math.max(...metrics.map(m=>m.width)):pos.x;
          if(minX<pad-1e-6||maxX>w-pad+1e-6) continue;
          let cursor=pos.y;
          const fitted=metrics.map(m=>{
            const y=cursor+m.height/2; cursor+=m.height+gap;
            return {text:m.text,x:pos.x,y,anchor:pos.anchor,fontSize,width:m.width,height:m.height};
          });
          const top=fitted[0].y-fitted[0].height/2,bottom=fitted.at(-1).y+fitted.at(-1).height/2;
          if(top<pad-1e-6||bottom>h-pad+1e-6) continue;
          return {type:'inside',lines:fitted,fontSize,physicalPt:pt,pattern:pi,position:oi};
        }
      }
    }
    return {type:'callout',marker:null,markerLayout:fitMarker(options.marker||'1',w,h,scale,measure)};
  }

  /* Axis-oriented labels: horizontal dimension follows the displayed width;
     vertical dimension is rotated to follow the displayed height. */
  function layoutOrientedPartLabel(options={}){
    const w=Number(options.width)||0,h=Number(options.height)||0;
    const ref=String(options.reference??''),horizontal=String(options.horizontalDimension??''),vertical=String(options.verticalDimension??'');
    const scale=Math.max(Number(options.printScale)||0.1,0.0001);
    const measure=typeof options.measure==='function'?options.measure:fallbackMeasure;
    const minPt=Number(options.minReadablePt)||6,targetPt=Number(options.targetPt)||10;
    const pad=Math.max(.5,Math.min(2,Math.min(w,h)*.07));
    for(let pt=targetPt;pt>=minPt-1e-6;pt-=.5){
      const fs=pt*PT_TO_MM/scale;
      const r=measure(ref,fs),x=measure(horizontal,fs),y=measure(vertical,fs);
      const gap=Math.max(.35,fs*.2);
      // Rotated vertical text consumes its text height across the part width,
      // and its text width along the part height.
      if(r.width>w-2*pad||r.height>h-2*pad) continue;
      if(x.width>w-2*pad||x.height>h-2*pad) continue;
      if(y.height>w-2*pad||y.width>h-2*pad) continue;
      const horizontalY=h-pad-x.height/2;
      const verticalX=pad+y.height/2;
      const refY=Math.max(pad+r.height/2,Math.min(h/2,horizontalY-r.height/2-gap));
      // Avoid the rotated dimension strip at the left and the horizontal strip below.
      if(refY-r.height/2<verticalX+y.height/2+gap) continue;
      if(refY+r.height/2>horizontalY-x.height/2-gap) continue;
      return {type:'inside',oriented:true,lines:[
        {text:ref,x:w/2,y:refY,anchor:'middle',fontSize:fs,width:r.width,height:r.height,rotation:0},
        {text:horizontal,x:w/2,y:horizontalY,anchor:'middle',fontSize:fs,width:x.width,height:x.height,rotation:0},
        {text:vertical,x:verticalX,y:h/2,anchor:'middle',fontSize:fs,width:y.width,height:y.height,rotation:-90}
      ],fontSize:fs,physicalPt:pt};
    }
    return {type:'callout',marker:null,markerLayout:fitMarker(options.marker||'1',w,h,scale,measure)};
  }
  function fitMarker(marker,w,h,scale,measure=fallbackMeasure){
    const pad=Math.max(.1,Math.min(.8,Math.min(w,h)*.06));
    for(let pt=8;pt>=4;pt-=.5){
      const fontSize=pt*PT_TO_MM/Math.max(scale,.0001),m=measure(String(marker),fontSize);
      if(m.width<=w-2*pad&&m.height<=h-2*pad) return {text:String(marker),x:w/2,y:h/2,anchor:'middle',fontSize,width:m.width,height:m.height,physicalPt:pt};
    }
    // For exceptionally thin slivers, fit the biggest contained marker even if
    // it drops below the nominal 4 pt minimum; the external schedule remains authoritative.
    const maxFont=Math.max(.15,Math.min((w-2*pad)/Math.max(1,String(marker).length*.6),(h-2*pad)));
    const m=measure(String(marker),maxFont);
    return {text:String(marker),x:w/2,y:h/2,anchor:'middle',fontSize:maxFont,width:m.width,height:m.height,physicalPt:maxFont*scale/PT_TO_MM};
  }
  return {layoutPartLabel,layoutOrientedPartLabel,fitMarker};
});
