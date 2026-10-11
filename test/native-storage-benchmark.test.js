'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {parse,benchmark,dockerSample}=require('../scripts/native-storage-benchmark'),{checkpoint}=require('../scripts/storage-job-benchmark');
const image='sha256:'+'a'.repeat(64),config={image,engine:'opencode',workers:5,jobs:12};
const checks=Object.fromEntries(['nativeResponse','owningActorMcp','modelReceivedToolResult','checkpointSaved','containerStopped','privateSessionSaved','privateSessionRestored','nativeHistoryReachedModel','retryContainerStopped'].map(k=>[k,true]));
async function simulatedRunner(image,engine,continuity,o){
 const h=o.home;if(!h.getAgent(o.actor))h.createAgent({name:o.actor});
 let source=h.createJob(o.actor,'Synthetic original',o.jobOptions);source=checkpoint(h,source,16384);source=h.updateJob(source.agent,source.id,{status:'running'});await o.afterTask?.({home:h,job:source});h.updateJob(source.agent,source.id,{status:'interrupted'});
 let current=h.createJob(o.actor,'Synthetic retry',o.jobOptions);current=h.updateJob(current.agent,current.id,{retryOf:source.id});await o.beforeResume?.({home:h,sourceJob:source,job:current});current=checkpoint(h,current,16384);h.updateJob(current.agent,current.id,{status:'review'});
 return {ok:true,checks,fixtureJobs:{source:source.id,current:current.id}};
}
const deps={preflight:async()=>({ok:true}),dockerSample:async()=>({ok:true,ownedContainersAbsent:true}),runner:simulatedRunner};
test('benchmark accepts bounded explicit cases only, no production Home or mutable image',()=>{
 assert.deepEqual(parse([image]),{image,engine:'opencode',workers:1,jobs:1});
 for(const args of [[image,'--home','production'],['latest'],[image,'--jobs','0'],[image,'--jobs','1001'],[image,'--workers','2'],[image,'--engine','claude'],[image,'--jobs','1','--jobs','2']])assert.throws(()=>parse(args));
});
test('simulated harness accumulates retained jobs, measures net release, preserves source and runs post-release hook',async t=>{
 const r=await benchmark(config,deps);t.after(()=>fs.rmSync(path.dirname(r.reportPath),{recursive:true,force:true}));
 assert.equal(r.status,'passed_fixture');assert.equal(r.execution,'simulated_test_adapter');assert.equal(r.full100JobFixture,false);assert.equal(r.durableJobRecords,26);assert.equal(r.retention.protectedPointersUnchanged,true);assert.ok(r.retention.netManagedLogicalReclaimedBytes>0);assert.equal(r.postRetirementNativeChecks.nativeHistoryReachedModel,true);assert.ok(r.samples.find(s=>s.stage==='running_with_checkpoint').checkpointBytesByState.running>0);assert.ok(r.samples.find(s=>s.stage==='completed_12').checkpointBytesByState.done>0);
 const {Home}=require('../lib/home'),h=new Home(path.join(path.dirname(r.reportPath),'home')).ensure(),jobs=require('../lib/checkpoint-retention').inventory(h).jobs;
 assert.equal(jobs.filter(j=>j.storageRetirement?.status==='released').length,12);assert.equal(jobs.filter(j=>j.status==='interrupted'&&j.nativeCheckpoint).length,13);
});
test('preflight failure invokes no runner and creates no retained fixture',async()=>{
 const r=await benchmark(config,{...deps,preflight:async()=>({ok:false,error:'Unavailable'}),runner:()=>assert.fail('runner must not start')});assert.equal(r.stage,'runtime');assert.equal(r.reportPath,undefined);
});
test('runner failure retains diagnostic Home without retirement',async t=>{
 const r=await benchmark(config,{...deps,runner:async()=>({ok:false,error:'Controlled failure'})});t.after(()=>fs.rmSync(path.dirname(r.reportPath),{recursive:true,force:true}));assert.equal(r.status,'failed');assert.equal(r.retention,undefined);assert.ok(fs.existsSync(r.reportPath));
});
test('Docker sampler uses exact owned name and fixed read-only commands; refuses unknown/living containers',async t=>{
 const {Home}=require('../lib/home'),os=require('os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-df-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const h=new Home(root).ensure();h.createAgent({name:'fixture-worker-0'});let j=h.createJob('fixture-worker-0','Owned');const name='orbit-native-'+require('crypto').randomUUID();h.updateJob(j.agent,j.id,{containment:{name,status:'stopped'}});
 const calls=[],exec=async(args,ms)=>{calls.push(args);assert.equal(ms,10000);return {code:0,stdout:args[0]==='system'?JSON.stringify({Type:'Images',Size:'3.81GB',TotalCount:4}):''};};
 const r=await dockerSample(h,exec);assert.equal(r.ok,true);assert.deepEqual(calls[1],['container','ls','--all','--filter','name=^/'+name+'$','--format','{{.ID}}']);assert.ok(!JSON.stringify(r).includes(name));
 assert.equal((await dockerSample(h,async()=>({code:1,stdout:'SECRET'}))).ok,false);
 assert.equal((await dockerSample(h,async(args)=>args[0]==='system'?exec(args,10000):{code:0,stdout:'remaining'})).ok,false);
});
test('100-task simulated acceptance records 202 durable jobs; still labelled simulation',async t=>{
 const r=await benchmark({...config,jobs:100},deps);t.after(()=>fs.rmSync(path.dirname(r.reportPath),{recursive:true,force:true}));assert.equal(r.status,'passed_fixture');assert.equal(r.full100JobFixture,true);assert.equal(r.durableJobRecords,202);assert.equal(r.execution,'simulated_test_adapter');assert.equal(r.retention.protectedPointersUnchanged,true);
});
test('durable outstanding reservation refuses the next task before invoking its native runner',async t=>{
 let calls=0;const r=await benchmark({...config,jobs:2},{...deps,runner:async(...args)=>{calls++;const result=await simulatedRunner(...args),o=args[3];o.home.createJob(o.actor,'Outstanding fixture reservation',{storageReservationBytes:4096*1024*1024});return result;}});t.after(()=>fs.rmSync(path.dirname(r.reportPath),{recursive:true,force:true}));assert.equal(r.status,'failed');assert.match(r.error,/headroom/);assert.equal(calls,1);assert.equal(r.retention,undefined);
});
