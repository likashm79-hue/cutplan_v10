'use strict';
/* Dedicated worker keeps deep candidate evaluation off the UI thread. */
importScripts('./nesting-engine.js');
let currentJob = 0;
self.onmessage = async event => {
  const message=event.data||{};
  if(message.type==='cancel'){currentJob++;return;}
  if(message.type!=='optimize') return;
  const job=++currentJob;
  try {
    const plan=await CutPlanEngine.optimizeAsync(message.rows,message.options,progress=>{
      if(job===currentJob) self.postMessage({type:'progress',job,progress});
    });
    if(job===currentJob) self.postMessage({type:'result',job,plan});
  } catch(error) {
    if(job===currentJob) self.postMessage({type:'error',job,error:error?.message||String(error)});
  }
};
