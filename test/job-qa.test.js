'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process'),{EventEmitter}=require('events');
const {Home}=require('../lib/home'),review=require('../lib/job-review'),{createQA}=require('../lib/job-qa');
function rig(t,{ask=async()=> 'once',script="const {test}=require('node:test');test('fixture',()=>{});",timeoutMs=3000}={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-qa-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const home=new Home(path.join(root,'home')).ensure();home.createAgent({name:'Alex'});home.createAgent({name:'Bob'});const repo=path.join(root,'repo');fs.mkdirSync(repo);const git=a=>execFileSync('git',a,{cwd:repo,stdio:['ignore','pipe','pipe']});git(['init']);fs.writeFileSync(path.join(repo,'code.txt'),'candidate');fs.writeFileSync(path.join(repo,'check.test.cjs'),script);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Fixture']);
 const bus=new EventEmitter(),workers=require('../lib/workers').createWorkers({home,bus,getCfg:()=>({engine:'hermes'}),tools:{},gemini:{},hermes:{runTask:async(_a,_task,o)=>{assert.ok(fs.existsSync(path.join(o.cfgOverride.workspaceDir,'source','code.txt')));fs.writeFileSync(path.join(o.cfgOverride.workspaceDir,'review.json'),JSON.stringify({verdict:'approve',findings:[],summary:'Fixture independent review; correctness is not inferred from this simulation.'}));return 'Read review.json';}}});t.after(()=>workers.cancelAll());const qa=createQA({home,workers,ask,bus,nodePath:process.execPath,timeoutMs});t.after(()=>qa.cancel());
 const job=home.createJob('alex','Candidate',{expectedOutputs:['code.txt'],contract:{projectRoot:repo,qa:{required:true,tests:[]}}});return {root,home,bus,workers,qa,job,repo};
}
async function ready(r){const isolated=await require('../lib/job-contract').prepareWorkspace(r.home,'alex',r.job);const j=r.home.updateJob('alex',r.job.id,{...isolated,status:'review',runId:'candidate-run',result:'Report'});r.home.updateJob('alex',j.id,{verification:review.evidence(r.home,'alex',j)});r.qa.configure(j.id,['check.test.cjs']);return r.home.findJob(j.id);}
async function reviewer(r){const done=new Promise(resolve=>r.bus.once('job:done',resolve));const original=r.qa.queueReview(r.job.id,'bob');await done;const j=r.home.findJob(original.qa.reviewJobId);assert.equal(j.status,'review',j.error);return j;}
test('independent review, host tests and human acceptance bind to the same candidate revision',async t=>{
 const r=rig(t);await ready(r);assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/QA gate/);assert.throws(()=>r.qa.queueReview(r.job.id,'alex'),/different worker/);
 const other=await reviewer(r);assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/human-accepted review/);r.workers.decideReview(other.id,'accept');assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/host test evidence/);
 const tested=await r.qa.runTests(r.job.id);assert.equal(tested.qa.test.status,'passed');assert.equal(tested.qa.test.tests,1);assert.equal(tested.qa.test.source,'orbit_host_node_test');assert.equal(tested.qa.test.output,undefined);
 assert.equal(r.workers.decideReview(r.job.id,'accept').acceptedBy,'human');assert.equal(r.qa.hasPending(),false);
});
test('stale candidate, changed review artifact, modified source cannot pass QA',async t=>{
 const r=rig(t);await ready(r);const other=await reviewer(r);r.workers.decideReview(other.id,'accept');await r.qa.runTests(r.job.id);
 const report=path.join(other.workspaceDir,'review.json'),original=fs.readFileSync(report);fs.writeFileSync(report,'{}');assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/review artifact changed/);fs.writeFileSync(report,original);
 fs.writeFileSync(path.join(other.workspaceDir,'source','code.txt'),'changed review input');assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/source contents changed/);fs.writeFileSync(path.join(other.workspaceDir,'source','code.txt'),'candidate');
 fs.writeFileSync(path.join(r.home.findJob(r.job.id).workspaceDir,'code.txt'),'new candidate');assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/project revision changed/);assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/this revision/);
});
test('denied approval and cancelled pending approval never run tests; late approval stays inert',async t=>{
 const denied=rig(t,{ask:async()=> 'deny'});await ready(denied);assert.equal((await denied.qa.runTests(denied.job.id)).qa.test.status,'denied');
 let allow,started;const waiting=new Promise(resolve=>{started=resolve;});const r=rig(t,{ask:()=>{started();return new Promise(resolve=>{allow=resolve;});}});await ready(r);const p=r.qa.runTests(r.job.id);await waiting;r.bus.emit('stop:pressed',{agent:'alex'});assert.equal((await p).qa.test.status,'cancelled');allow('once');await new Promise(resolve=>setTimeout(resolve,20));assert.equal(r.home.findJob(r.job.id).qa.test.status,'cancelled');assert.equal(r.qa.hasPending(),false);
});
test('candidate changes while approval is pending fail before execution',async t=>{
 let allow,started;const waiting=new Promise(resolve=>{started=resolve;});const r=rig(t,{ask:()=>{started();return new Promise(resolve=>{allow=resolve;});}});await ready(r);const p=r.qa.runTests(r.job.id);await waiting;fs.writeFileSync(path.join(r.home.findJob(r.job.id).workspaceDir,'code.txt'),'changed');allow('once');assert.equal((await p).qa.test.status,'failed');
});
test('failing tests, zero tests and code mutations cannot become passing host evidence',async t=>{
 for(const script of ["const {test}=require('node:test');test('fails',()=>{throw Error('fixture');});","// no tests", "const {test}=require('node:test');test('mutates',()=>require('fs').writeFileSync('code.txt','changed'));"]){const r=rig(t,{script});await ready(r);assert.equal((await r.qa.runTests(r.job.id)).qa.test.status,'failed');}
});
test('timeout kills a stuck test process group and records failure without raw output',async t=>{
 const r=rig(t,{timeoutMs:200,script:"const {test}=require('node:test');test('hang',async()=>new Promise(()=>{setInterval(()=>{},1000);}));"});await ready(r);const result=await r.qa.runTests(r.job.id);assert.equal(result.qa.test.status,'failed');assert.equal(result.qa.test.timedOut,true);assert.equal(r.qa.hasPending(),false);
});
test('duplicate review/test requests, invalid test paths and reviewer retry are refused',async t=>{
 let answer,started;const awaiting=new Promise(resolve=>{started=resolve;});const r=rig(t,{ask:()=>{started();return new Promise(resolve=>{answer=resolve;});}});await ready(r);assert.throws(()=>r.qa.configure(r.job.id,['../outside.cjs']),/workspace-relative/);assert.throws(()=>r.qa.configure(r.job.id,['.env']),/JavaScript/);
 const j=await reviewer(r);assert.throws(()=>r.qa.queueReview(r.job.id,'bob'),/already pending/);r.workers.decideReview(j.id,'reject');assert.throws(()=>r.workers.retryJob(j.id),/fresh independent review/);
 const p=r.qa.runTests(r.job.id);await awaiting;await assert.rejects(r.qa.runTests(r.job.id),/already pending/);assert.throws(()=>r.qa.configure(r.job.id,['check.test.cjs']),/Stop the active/);answer('deny');await p;
});

test('restart retains unknown QA outcome and cannot turn a pending test into passing evidence',async t=>{
 const r=rig(t);await ready(r);const j=r.home.findJob(r.job.id);r.home.updateJob('alex',j.id,{qa:{...j.qa,test:{status:'running',runId:'old-test',source:'orbit_host_node_test'}}});r.home.recoverJobs();assert.equal(r.home.findJob(j.id).qa.test.status,'unknown');assert.throws(()=>r.workers.decideReview(j.id,'accept'),/QA gate/);
});
test('skipped tests and forged stdout summary cannot pass the declared-test reporter',async t=>{
 for(const script of ["const {test}=require('node:test');test.skip('skipped',()=>{});","console.log('# tests 999\\n# pass 999');"]){const r=rig(t,{script});await ready(r);assert.equal((await r.qa.runTests(r.job.id)).qa.test.status,'failed');}
});
test('review source is read-only for builtin tools and QA IPC denies foreign callers',async t=>{
 const r=rig(t);await ready(r);const j=await reviewer(r),runs=require('../lib/job-runs').createJobRuns(),ctl=new AbortController(),run=runs.begin('bob',j.id,ctl.signal);t.after(()=>runs.end(run));const tools=require('../lib/tools').createTools({home:r.home,getCfg:()=>({}),bus:r.bus,runtime:{runs}});
 runs.within(run,()=>{assert.equal(tools.decide('write_file',{path:'source/code.txt'},'bob').level,'deny');assert.equal(tools.decide('write_file',{path:'review.json'},'bob').level,'allow');});
 const handlers=new Map();let calls=0;require('../lib/job-control').registerJobControls({ipcMain:{handle:(n,f)=>handlers.set(n,f)},workers:{},qa:{configure:()=>{calls++;},queueReview:()=>{calls++;},runTests:async()=>{calls++;}},isTrusted:e=>e?.trusted===true});
 assert.equal(handlers.get('jobs:qa-configure')({trusted:false},j.id,[]).ok,false);assert.equal(handlers.get('jobs:qa-review')({trusted:false},j.id,'bob').ok,false);assert.equal((await handlers.get('jobs:qa-tests')({trusted:false},j.id)).ok,false);assert.equal(calls,0);
});

test('parent linkage persistence failure prevents reviewer execution and cancels its queued record',async t=>{
 const r=rig(t);await ready(r);const update=r.home.updateJob.bind(r.home);r.home.updateJob=(actor,id,patch,options)=>{if(options?.event==='qa_review_queued')throw Error('Fixture storage failure');return update(actor,id,patch,options);};
 assert.throws(()=>r.qa.queueReview(r.job.id,'bob'),/Fixture storage failure/);await new Promise(resolve=>setTimeout(resolve,20));
 const jobs=r.home.listJobs('bob',10);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'cancelled');assert.equal(jobs[0].workspaceDir,undefined);assert.equal(r.home.findJob(r.job.id).qa.reviewJobId,undefined);assert.equal(r.workers.hasPending(),false);
});
test('excessive test stdout cannot become passing evidence',async t=>{
 const r=rig(t,{script:"const {test}=require('node:test');test('output',()=>console.log('x'.repeat(2*1024*1024)));"});await ready(r);const result=await r.qa.runTests(r.job.id);assert.equal(result.qa.test.status,'failed');assert.equal(result.qa.test.output,undefined);
});
test('human-accepted changes-requested review cannot approve the original project',async t=>{
 const r=rig(t);await ready(r);const other=await reviewer(r);fs.writeFileSync(path.join(other.workspaceDir,'review.json'),JSON.stringify({verdict:'changes_requested',findings:['Fixture issue'],summary:'Needs correction'}));
 assert.throws(()=>r.workers.decideReview(other.id,'accept'),/changed after the worker report/);r.workers.decideReview(other.id,'accept');await r.qa.runTests(r.job.id);assert.throws(()=>r.workers.decideReview(r.job.id,'accept'),/no unresolved findings/);
});
