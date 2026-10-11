'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),L=require('../lib/latency');
test('monotonic overlapping intervals use union, marks are one-shot, no missing metric becomes zero',()=>{
 let t=0;const tr=L.create('worker',{now:()=>t,engine:'opencode'});t=5;tr.mark('engine_submit');const a=tr.span('tool');t=10;const b=tr.span('approval_wait');t=20;b();t=25;a();tr.mark('engine_submit');t=30;const r=tr.finish();assert.equal(r.marks.engine_submit,5);assert.equal(r.spans.tool.unionMs,20);assert.equal(r.spans.approval_wait.unionMs,10);assert.equal(r.unattributedElapsedMs,10);assert.equal(r.coverage.complete,true);const s=L.summarize([r]).groups['worker/opencode/success/no_provider_span'];assert.equal(s.metrics.first_textMs,undefined);assert.equal(s.metrics.elapsedMs.p95,30);assert.deepEqual(L.percentile([]),{samples:0,p50:null,p95:null,max:null});
});
test('nearest-rank p50/p95/max include valid zero and ignore non-finite values',()=>{assert.deepEqual(L.percentile([0,1,2,3,4,NaN,Infinity,-1]),{samples:5,p50:2,p95:4,max:4});});
test('parallel async contexts isolate traces; instrumentation preserves sync result and rejection',async()=>{
 let t=0;const a=L.create('commander',{now:()=>t}),b=L.create('worker',{now:()=>t});
 await Promise.all([L.within(a,async()=>{assert.equal(L.current(),a);const end=L.span('model_request');await Promise.resolve();t=10;end();assert.equal(L.timed('tool',()=>42),42);assert.throws(()=>L.timed('tool',()=>{throw Error('same');}),/same/);}),L.within(b,async()=>{assert.equal(L.current(),b);await assert.rejects(L.timed('checkpoint',async()=>{throw Error('rejected');}),/rejected/);L.mark('first_action');})]);
 const ar=a.finish(),br=b.finish('failed');assert.equal(ar.spans.model_request.count,1);assert.equal(br.spans.model_request,undefined);assert.equal(br.outcome,'failed');assert.equal(L.current(),undefined);
});
test('closed/bounded traces ignore late callbacks; incomplete span metrics excluded, no raw payload retained',()=>{
 let t=0;const tr=L.create('worker',{now:()=>t});for(let n=0;n<520;n++){const stop=tr.span('tool');t++;stop();}const pending=tr.span('model_request');const r=tr.finish('cancelled');pending();tr.mark('first_text');assert.equal(r.coverage.complete,false);assert.equal(r.spans.tool.count,512);assert.equal(r.marks.first_text,undefined);const s=L.summarize([r]).groups['worker/unknown/cancelled/no_provider_span'];assert.equal(s.metrics.toolUnionMs,undefined);assert.equal(s.incomplete,1);tr.mark('PRIVATE_TOKEN');assert.ok(!JSON.stringify(r).includes('PRIVATE_TOKEN'));
});
test('wall-clock rollback cannot reduce observed monotonic elapsed milestones',()=>{let t=10;const tr=L.create('worker',{now:()=>t});t=20;tr.mark('first_action');t=15;assert.equal(tr.finish().elapsedMs,10);});
test('worker latency is persisted and correlated without authorizing jobs, existing queue still runs once',async t=>{
 const fs=require('fs'),os=require('os'),path=require('path'),{Home}=require('../lib/home'),{EventEmitter}=require('events'),{createWorkers}=require('../lib/workers');const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-latency-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const h=new Home(root).ensure();h.createAgent({name:'Alex'});let calls=0;const workers=createWorkers({home:h,getCfg:()=>({engine:'hermes'}),tools:{},gemini:{},bus:new EventEmitter(),hermes:{runTask:async(a,task,o)=>{calls++;o.onProgress({tool:'read',status:'running'});o.onText('Fixture');return 'Fixture report';}}});
 const parent=L.create('commander'),j=L.within(parent,()=>workers.dispatch('alex','Fixture'));
 for(let n=0;n<100&&!h.findJob(j.id).latency;n++)await new Promise(r=>setTimeout(r,5));const saved=h.findJob(j.id);assert.equal(calls,1);assert.equal(saved.status,'review');assert.equal(saved.latency.parentId,parent.id);assert.equal(saved.latency.kind,'worker');assert.equal(saved.latency.engine,'hermes');assert.ok(saved.latency.marks.first_text>=0);assert.equal(saved.acceptedBy,undefined);
 const before=fs.readFileSync(h.p('agents','alex','jobs',j.id+'.json'));const report=require('../scripts/latency-report').report(root);assert.equal(report.jobsWithSamples,1);assert.deepEqual(fs.readFileSync(h.p('agents','alex','jobs',j.id+'.json')),before);
});

test('renderer reports bind an existing request once; bounded values only, no raw text or permissions',()=>{const tr=L.create('commander');tr.finish();assert.equal(L.rendered('unknown',{feedbackMs:1,replyDomMs:2}),false);assert.equal(L.rendered(tr.id,{feedbackMs:3,replyDomMs:2}),false);assert.equal(L.rendered(tr.id,{feedbackMs:1,replyDomMs:2,prompt:'secret'}),false);assert.equal(L.rendered(tr.id,{feedbackMs:1,replyDomMs:2}),true);assert.equal(L.rendered(tr.id,{feedbackMs:1,replyDomMs:2}),false);const group=Object.values(L.summarize([tr.result]).groups)[0];assert.equal(group.metrics.renderer_replyDomMs.p95,2);});
test('provider interval includes response-body consumption and failed fetch without claiming first token',async()=>{
 const real=global.fetch,gemini=require('../lib/gemini');let t=0;
 try{const tr=L.create('commander',{now:()=>t,engine:'builtin'});global.fetch=async()=>{t+=3;return {ok:true,text:async()=>{t+=17;return JSON.stringify({candidates:[{content:{parts:[{text:'Synthetic'}]}}]});}};};
  await L.within(tr,()=>gemini.generate({apiKey:'fixture-only',textModel:'fixture',geminiRetryDelays:[],geminiNoFallback:true},{contents:[]}));const r=tr.finish();assert.equal(r.spans.model_request.unionMs,20);assert.equal(r.marks.first_text,undefined);
  const failed=L.create('commander',{now:()=>t});global.fetch=async()=>{t+=5;throw Error('Offline fixture');};await assert.rejects(L.within(failed,()=>gemini.generate({apiKey:'fixture-only',textModel:'fixture',geminiRetryDelays:[],geminiNoFallback:true},{})),/Offline/);const f=failed.finish('failed');assert.equal(f.spans.model_request.unionMs,5);assert.equal(f.coverage.complete,true);
 }finally{global.fetch=real;}
});
