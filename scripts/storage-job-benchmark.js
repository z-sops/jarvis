'use strict';
// Disposable scheduler/checkpoint fixture, NOT native CLI/provider or Docker proof.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{EventEmitter}=require('events');
const {Home}=require('../lib/home'),{createWorkers}=require('../lib/workers'),C=require('../lib/native-containment');
const {measure}=require('../lib/storage-guardian'),{createRetention}=require('../lib/checkpoint-retention');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function checkpoint(home,job,bytes=65536){
 const runId=job.runId||crypto.randomUUID(),workspaceDir=home.p('workspace',job.agent,'.native',job.id),dir='native-candidates/'+job.id+'-'+runId+'/'+crypto.randomUUID();fs.mkdirSync(workspaceDir,{recursive:true});fs.mkdirSync(home.p(...dir.split('/')),{recursive:true});
 const content=Buffer.alloc(bytes,42),file={path:'proof.txt',bytes:content.length,sha256:sha(content)};fs.writeFileSync(home.p(...dir.split('/'),'proof.txt'),content);
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(Buffer.alloc(bytes,7)),cipher.final()]);
 // Synthetic encrypted payload is deliberately NOT a native state adapter or credential.
 const data={version:1,actor:job.agent,jobId:job.id,runId,root:workspaceDir,input:[],files:[file],fixtureEncryptedCopy:{ciphertext:encrypted.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64')}};
 require('../lib/job-storage').atomicWrite(home.p(...dir.split('/'),'.orbit-checkpoint.json'),data);
 return home.updateJob(job.agent,job.id,{runId,workspaceDir,nativeCheckpoint:{version:1,actor:job.agent,jobId:job.id,runId,root:workspaceDir,dir,sha256:sha(Buffer.from(JSON.stringify(data))),at:new Date().toISOString()},containment:{status:'stopped'}});
}
async function benchmark(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-job-storage-')),home=new Home(path.join(temp,'home')).ensure(),bus=new EventEmitter(),cfg={engine:'hermes',nativeContinuity:false,storageQuotaMiB:4096,storageReserveMiB:512,storageJobReserveMiB:320,storageKeepDays:30};
 for(let i=0;i<5;i++)home.createAgent({name:'Worker '+i});
 let calls=0;const workers=createWorkers({home,bus,getCfg:()=>cfg,tools:{},gemini:{},hermes:{async runTask(agent){calls++;const job=home.listJobs(agent.id,10000).find(j=>j.status==='running');checkpoint(home,job);return 'Synthetic fixture complete; requires human review.';}}});
 try{const samples=[measure(home.root)],jobs=[];for(let n=0;n<120;n++){const actor='worker-'+n%5,settled=new Promise(resolve=>bus.once('job:done',resolve));const created=workers.dispatch(actor,'Storage fixture '+n);await settled;const job=home.findJob(created.id);if(job.status!=='review')throw Error('Fixture worker did not settle to review: '+job.error);workers.decideReview(job.id,'accept');home.updateJob(actor,job.id,{acceptedAt:new Date(Date.now()-40*86400000).toISOString()});jobs.push(created.id);if((n+1)%20===0)samples.push(measure(home.root));}
  const protectedJobs=[];for(const status of ['running','failed','interrupted']){let j=home.createJob('worker-0','Protected '+status,{storageReservationBytes:320*1024*1024});j=checkpoint(home,j);j=home.updateJob(j.agent,j.id,{status});protectedJobs.push(j);}
  const byState={};for(const job of require('../lib/checkpoint-retention').inventory(home).jobs){const bytes=job.nativeCheckpoint?measure(home.p(...job.nativeCheckpoint.dir.split('/'))).logicalBytes:0;byState[job.status]=(byState[job.status]||0)+bytes;}
  const restarted=new Home(home.root).ensure();restarted.recoverJobs();const recovery=protectedJobs.at(-1);C.restoreCheckpoint(restarted,restarted.findJob(recovery.id));const protectedHash=restarted.findJob(recovery.id).nativeCheckpoint.sha256;
  const service=createRetention({home:restarted,getCfg:()=>cfg}),before=measure(restarted.root);let removedLogicalBytes=0;for(let i=0;i<jobs.length;i+=100){const r=service.apply(service.preview(jobs.slice(i,i+100)).token);removedLogicalBytes+=r.removedLogicalBytes;}
  const after=measure(restarted.root);C.restoreCheckpoint(restarted,restarted.findJob(recovery.id));
  return {version:1,workers:5,sequentialJobs:120,scriptedEngineCalls:calls,samples:samples.map(s=>({logicalBytes:s.logicalBytes,allocatedBytes:s.allocatedBytes,categories:s.totals,coverage:s.coverage})),checkpointBytesByState:byState,retention:{removedLogicalBytes,netManagedLogicalReclaimedBytes:before.logicalBytes-after.logicalBytes,allocatedReclaimedBytes:before.allocatedBytes-after.allocatedBytes},protectedWorkspaceRestore:fs.readFileSync(path.join(recovery.workspaceDir,'proof.txt')).length===65536,protectedPointerUnchanged:restarted.findJob(recovery.id).nativeCheckpoint.sha256===protectedHash,scope:'120 actual durable jobs through existing five-worker scheduler; scripted engine and synthetic encrypted checkpoint bytes. Workspace restore uses existing helper after Home restart and retirement. NO real native private session/TODO/provider/Docker/Windows/power-cut proof.'};
 }finally{workers.cancelAll();fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module)benchmark().then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error('Disposable storage fixture failed.');process.exitCode=1;});
module.exports={checkpoint,benchmark};
