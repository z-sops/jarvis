'use strict';
// Owner-run disposable Home only. Native CLIs, deterministic local model, no billing.
const fs=require('fs'),os=require('os'),path=require('path');
const {Home}=require('../lib/home'),C=require('../lib/native-containment');
const {check}=require('./native-task-check'),{measure}=require('../lib/storage-guardian');
const {inventory,createRetention}=require('../lib/checkpoint-retention'),A=require('../lib/storage-admission');
function parse(args){
 const image=args.shift();if(!/^sha256:[a-f0-9]{64}$/.test(image||''))throw Error('Supply an installed immutable image ID.');
 const out={image,engine:'opencode',workers:1,jobs:1},seen=new Set();
 while(args.length){const flag=args.shift(),key={'--engine':'engine','--workers':'workers','--jobs':'jobs'}[flag];if(!key||seen.has(key)||!args.length)throw Error('Use --engine hermes|opencode --workers 1|5 --jobs 1..1000; no existing Home is accepted.');seen.add(key);out[key]=key==='engine'?args.shift():Number(args.shift());}
 if(!['hermes','opencode'].includes(out.engine)||![1,5].includes(out.workers)||!Number.isSafeInteger(out.jobs)||out.jobs<1||out.jobs>1000)throw Error('Invalid benchmark case.');return out;
}
async function dockerSample(home,exec=C.docker){
 const df=await exec(['system','df','--format','{{json .}}'],10000);let rows;
 try{if(df.code||df.stdout.length>65536)throw Error();rows=df.stdout.trim().split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s)).map(r=>({type:['Images','Containers','Local Volumes','Build Cache'].includes(r.Type)?r.Type:'other',size:/^[0-9.]+\s*[a-zA-Z]+$/.test(r.Size||'')?r.Size:null,count:/^\d+$/.test(String(r.TotalCount))?Number(r.TotalCount):null}));if(!rows.length||rows.length>8||rows.some(r=>r.size===null||r.count===null))throw Error();}catch{return {ok:false,issue:'docker_storage_unknown'};}
 const names=[...new Set(inventory(home).jobs.map(j=>j.containment?.name).filter(Boolean))];
 if(names.some(n=>!/^orbit-native-[a-f0-9-]{36}$/.test(n)))return {ok:false,issue:'container_identity_unknown'};
 // Exact name filters; read only. Never stop/prune anything from this sampler.
 for(const name of names){const r=await exec(['container','ls','--all','--filter','name=^/'+name+'$','--format','{{.ID}}'],10000);if(r.code||r.stdout.trim())return {ok:false,issue:'owned_container_not_confirmed_absent',checked:names.length};}
 return {ok:true,rows,ownedContainersAbsent:true,checked:names.length,scope:'Shared daemon totals, not Orbit-exclusive attribution or Docker VM physical size. Images/cache retained; no prune.'};
}
function snapshot(home){const s=measure(home.root);if(!s.coverage.complete)throw Error('Storage sample incomplete; benchmark stopped.');const byState={},seen=new Set();let checkpointMetadataBytes=0;
 for(const j of inventory(home).jobs){const cp=j.nativeCheckpoint;if(!cp||seen.has(cp.dir))continue;seen.add(cp.dir);const p=home.p(...cp.dir.split('/')),m=measure(p);if(!m.coverage.complete)throw Error('Checkpoint measurement incomplete.');byState[j.status]=(byState[j.status]||0)+m.logicalBytes;checkpointMetadataBytes+=fs.statSync(path.join(p,'.orbit-checkpoint.json')).size;}
 return {logicalBytes:s.logicalBytes,allocatedBytes:s.allocatedBytes,freeBytes:s.freeBytes,categories:s.totals,workers:s.workers,checkpointBytesByState:byState,checkpointMetadataBytes,coverage:s.coverage};
}
async function benchmark(config,deps={}){
 // Validate again even for programmatic callers, before any filesystem side effect.
 config=parse([config.image,'--engine',config.engine,'--workers',String(config.workers),'--jobs',String(config.jobs)]);
 const preflight=await (deps.preflight||C.checkRuntime)({nativeContainerImage:config.image},config.engine);
 if(!preflight.ok)return {status:'failed',stage:'runtime',error:preflight.error,config};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-native-growth-')),home=new Home(path.join(root,'home')).ensure();
 const cfg={storageQuotaMiB:4096,storageReserveMiB:512,storageJobReserveMiB:320,storageKeepDays:30};
 home.storageCheck=o=>A.check(home,cfg,o);
 const runner=deps.runner||check,sampler=deps.dockerSample||dockerSample,progress=deps.progress||(()=>{});
 const report={version:1,status:'failed',config,execution:deps.runner?'simulated_test_adapter':'real_native_cli',syntheticAcceptance:true,sequence:'Round-robin sequential tasks, not parallel throughput or production staffing proof.',samples:[],scope:'Disposable Home; local deterministic model, ephemeral in-memory encryption key. Explicit native restart in same parent. No live provider, billing, human approval, TODO/plugin portability, physical outage, OS key lifecycle or full-disk proof. Private fixture recovery cannot be decrypted after benchmark parent exits.'};
 let stage='initial_sample';
 try{
  report.samples.push({stage:'initial',...snapshot(home)});report.dockerBefore=await sampler(home);if(!report.dockerBefore.ok)throw Error('Docker accounting unavailable.');
  const completed=[];
  const run=async (index,options={})=>{const bytes=A.reserve(home,cfg);const result=await runner(config.image,config.engine,true,{home,actor:'fixture-worker-'+index%config.workers,runtimeVerified:true,jobOptions:{storageReservationBytes:bytes},...options});
   if(!result.ok)throw Error('Native fixture failed: '+String(result.error||'required checks failed').slice(0,200));
   const required=['nativeResponse','owningActorMcp','modelReceivedToolResult','checkpointSaved','containerStopped','privateSessionSaved','privateSessionRestored','nativeHistoryReachedModel','retryContainerStopped'];if(required.some(k=>result.checks?.[k]!==true))throw Error('Native acceptance evidence incomplete.');
   return result;
  };
  stage='accumulation';
  for(let n=0;n<config.jobs;n++){
   const r=await run(n,{afterTask:({home})=>{if(n===0)report.samples.push({stage:'running_with_checkpoint',...snapshot(home)});}});
   const j=home.findJob(r.fixtureJobs.current);if(!j||j.status!=='review'||!j.nativeCheckpoint)throw Error('Expected reviewed native recovery.');
   // Isolated synthetic fixture acceptance + age, NEVER production human authorization.
   home.updateJob(j.agent,j.id,{status:'done',acceptedBy:'human',acceptedAt:new Date(Date.now()-40*86400000).toISOString(),fixtureSyntheticAcceptance:true});completed.push(j.id);
   if((n+1)%10===0||n+1===config.jobs)report.samples.push({stage:'completed_'+(n+1),...snapshot(home)});
   progress({completed:n+1,total:config.jobs});
  }
  stage='retirement_then_native_resume';
  const probe=await run(config.jobs,{beforeResume:({home})=>{
   const protectedJobs=inventory(home).jobs.filter(j=>j.nativeCheckpoint&&!completed.includes(j.id));const before=snapshot(home),pointers=protectedJobs.map(j=>[j.id,j.nativeCheckpoint.sha256]);
   const retention=createRetention({home,getCfg:()=>cfg});let removed=0;
   // One checkpoint per bounded batch, same production reference/integrity validator.
   for(const id of completed)removed+=retention.apply(retention.preview([id]).token).removedLogicalBytes;
   const after=snapshot(home);report.retention={removedLogicalBytes:removed,netManagedLogicalReclaimedBytes:before.logicalBytes-after.logicalBytes,allocatedReclaimedBytes:before.allocatedBytes!==null&&after.allocatedBytes!==null?before.allocatedBytes-after.allocatedBytes:null,observedFreeBytesDelta:after.freeBytes-before.freeBytes,protectedPointersUnchanged:pointers.every(([id,hash])=>home.findJob(id)?.nativeCheckpoint?.sha256===hash),before,after};
   if(!report.retention.protectedPointersUnchanged||report.retention.netManagedLogicalReclaimedBytes<=0)throw Error('Retirement preservation or measured reclamation failed.');
  }});
  report.postRetirementNativeChecks=probe.checks;report.dockerAfter=await sampler(home);if(!report.dockerAfter.ok)throw Error('Owned container cleanup/accounting not confirmed.');
  report.samples.push({stage:'final',...snapshot(home)});report.durableJobRecords=inventory(home).jobs.length;
  report.full100JobFixture=config.jobs>=100;report.status='passed_fixture';
 }catch(e){report.stage=stage;report.error=String(e.message).slice(0,300);}
 // Retain owned fixture and bounded metadata report. No production files or recursive cleanup.
 report.fixtureRetained=true;const reportPath=path.join(root,'report.json');fs.writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600});return {...report,reportPath};
}
if(require.main===module){let config;try{config=parse(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}
 if(config)benchmark(config,{progress:s=>console.error('Native tasks '+s.completed+'/'+s.total)}).then(r=>{console.log(JSON.stringify(r,null,2));if(r.status!=='passed_fixture')process.exitCode=1;}).catch(()=>{console.error('Disposable benchmark failed; no automatic cleanup.');process.exitCode=1;});}
module.exports={parse,benchmark,dockerSample,snapshot};
