'use strict';
// Trusted UI only. Synchronous release shares Orbit's single main-process job writer.
// External processes writing Home concurrently are unsupported; this is not an OS lock.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),S=require('./job-storage');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const digest=v=>hash(JSON.stringify(v));
const DAY=86400000,MAX=128*1024*1024;
function regular(file,max=16*1024*1024){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>max)throw Error('Storage inventory contains an unsafe or oversized file.');return s;}
function directory(file){const s=fs.lstatSync(file);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Storage inventory contains an unsafe directory.');}
function inventory(home){
 directory(home.root);directory(home.p('agents'));directory(home.p('jarvis'));
 const actors=['jarvis',...fs.readdirSync(home.p('agents')).filter(id=>{directory(home.p('agents',id));if(!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id))throw Error('Invalid worker folder.');return true;})];
 const jobs=[],records=[];let count=0,totalBytes=0;const started=Date.now();const read=f=>{const st=regular(f);totalBytes+=st.size;if(totalBytes>64*1024*1024||Date.now()-started>5000)throw Error('Reference inventory exceeds bounded inspection capacity.');return fs.readFileSync(f);};
 for(const actor of actors){const dir=path.join(home.agentDir(actor),'jobs');directory(dir);for(const name of fs.readdirSync(dir)){if(!name.endsWith('.json'))continue;if(++count>20000||!S.validJobId(name.slice(0,-5)))throw Error('Job inventory is invalid or exceeds its limit.');const f=path.join(dir,name);regular(f);const bytes=read(f),job=S.readJob(home,actor,name.slice(0,-5));jobs.push(job);records.push([actor+'/'+name,hash(bytes)]);}}
 const projects=home.p('projects'),links=[];
 if(fs.existsSync(projects)){directory(projects);for(const name of fs.readdirSync(projects)){if(!name.endsWith('.json'))continue;if(++count>20000)throw Error('Reference inventory exceeds its limit.');const f=path.join(projects,name);regular(f);const b=read(f);links.push(JSON.parse(b));records.push(['projects/'+name,hash(b)]);}}
 return {jobs,links,revision:digest(records.sort((a,b)=>a[0].localeCompare(b[0])))};
}
function contains(value,strings){if(typeof value==='string')return strings.has(value);if(!value||typeof value!=='object')return false;return Object.values(value).some(v=>contains(v,strings));}
function reason(job,inv,keepDays,now){
 if(job.status!=='done'||job.acceptedBy!=='human')return 'Only human-accepted completed jobs can be released.';
 if(job.storagePinned)return 'Pinned recovery is protected.';
 if(!Number.isFinite(Date.parse(job.acceptedAt))||now-Date.parse(job.acceptedAt)<keepDays*DAY)return 'Recovery protection period has not elapsed.';
 if(job.containment&&job.containment.status!=='stopped')return 'Container cleanup is not confirmed.';
 if(!job.nativeCheckpoint&&job.storageRetirement?.status!=='prepared')return 'No native checkpoint is referenced.';
 return null;
}
function referenced(job,cp,inv){const refs=new Set([cp.dir,cp.sha256,job.id]);return inv.jobs.some(j=>j.id!==job.id&&contains(j,refs))||inv.links.some(p=>contains(p,refs));}
function files(home,job,cp,remaining=false){
 if(cp?.actor!==job.agent||cp.jobId!==job.id||cp.runId!==job.runId||cp.root!==job.workspaceDir||!/^native-candidates\/job-[a-f0-9-]+-[a-f0-9-]+\/[a-f0-9-]{36}$/.test(cp.dir))throw Error('Checkpoint ownership cannot be established.');
 if(cp.dir.split('/')[1]!==job.id+'-'+job.runId)throw Error('Checkpoint generation directory changed.');
 let dir=home.root;for(const part of cp.dir.split('/')){dir=path.join(dir,part);if(!fs.existsSync(dir)){if(remaining)return [];throw Error('Checkpoint directory is missing.');}directory(dir);}
 const list=[],stack=[[dir,'']];let bytes=0;
 while(stack.length){const [folder,prefix]=stack.pop();for(const name of fs.readdirSync(folder).sort()){const f=path.join(folder,name),rel=prefix+name,st=fs.lstatSync(f);if(st.isSymbolicLink())throw Error('Checkpoint contains a link.');if(st.isDirectory()){if(rel.split('/').length>32)throw Error('Checkpoint is too deep.');stack.push([f,rel+'/']);}else{regular(f,MAX);bytes+=st.size;if(bytes>MAX||list.length>=2100)throw Error('Checkpoint exceeds retention inspection bounds.');list.push({path:rel,bytes:st.size,sha256:hash(fs.readFileSync(f))});}}}
 if(!remaining){const meta=path.join(dir,'.orbit-checkpoint.json');regular(meta,40*1024*1024);const data=JSON.parse(fs.readFileSync(meta));if(digest(data)!==cp.sha256||data.actor!==job.agent||data.jobId!==job.id||data.runId!==job.runId||data.root!==job.workspaceDir||data.version!==cp.version)throw Error('Checkpoint metadata integrity changed.');require('./native-containment').validateCandidate(data.files,[],false);if(list.length!==data.files.length+1||data.files.some(f=>!list.some(a=>a.path===f.path&&a.bytes===f.bytes&&a.sha256===f.sha256)))throw Error('Checkpoint file manifest changed or contains unowned files.');}
 return list.sort((a,b)=>a.path.localeCompare(b.path));
}
function inspect(home,{keepDays=30,now=Date.now()}={}){
 if(!Number.isSafeInteger(keepDays)||keepDays<30||keepDays>3650)throw Error('Recovery protection must be 30–3650 days.');
 const inv=inventory(home),rows=[];let scannedBytes=0;const started=Date.now();
 for(const job of inv.jobs){const cp=job.storageRetirement?.status==='prepared'?job.storageRetirement.checkpoint:job.nativeCheckpoint;if(!cp)continue;let blocked=reason(job,inv,keepDays,now),manifest=null;
  if(!blocked&&referenced(job,cp,inv))blocked='Another job or project record references this recovery.';
  if(!blocked){manifest=files(home,job,cp,!!job.storageRetirement);if(job.storageRetirement&&manifest.some(f=>!job.storageRetirement.files.some(o=>digest(o)===digest(f))))throw Error('Interrupted release files changed. Inspect manually; release blocked.');}
  scannedBytes+=manifest?.reduce((n,f)=>n+f.bytes,0)||0;if(scannedBytes>256*1024*1024||Date.now()-started>5000)throw Error('Checkpoint inventory exceeds bounded inspection capacity.');
  rows.push({id:job.id,actor:job.agent,status:job.status,pinned:!!job.storagePinned,interruptedRelease:job.storageRetirement?.status==='prepared',eligible:!blocked,blocked,bytes:manifest?.reduce((n,f)=>n+f.bytes,0)??null});
 }
 return {revision:inv.revision,rows,keepDays,automaticDeletion:false,usage:require('./storage-guardian').measure(home.root)};
}
function createRetention({home,getCfg=()=>({}),isBusy=()=>false,afterStep=()=>{}}){
 const previews=new Map();
 const days=()=>getCfg().storageKeepDays??30;
 const ready=()=>{if(isBusy())throw Error('Stop active work and QA before changing recovery retention.');};
 function preview(ids){ready();if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw Error('Select 1–100 distinct completed jobs.');const report=inspect(home,{keepDays:days()}),inv=inventory(home);if(report.revision!==inv.revision)throw Error('Storage state changed.');const selected=ids.map(id=>{const row=report.rows.find(r=>r.id===id);if(!row?.eligible)throw Error(row?.blocked||'Recovery is not eligible.');const job=inv.jobs.find(j=>j.id===id),cp=job.storageRetirement?.checkpoint||job.nativeCheckpoint;return {id,actor:job.agent,checkpoint:cp,files:files(home,job,cp,!!job.storageRetirement)};});if(selected.reduce((n,s)=>n+s.files.reduce((m,f)=>m+f.bytes,0),0)>MAX)throw Error('Select a release batch of at most 128 MiB.');const token=crypto.randomUUID();if(previews.size>=20)previews.clear();previews.set(token,{root:path.resolve(home.root),revision:report.revision,days:days(),selected,expires:Date.now()+300000});return {token,jobs:selected.map(s=>({id:s.id,actor:s.actor,bytes:s.files.reduce((n,f)=>n+f.bytes,0)})),warning:'Release permanently removes native recovery for these completed jobs. Workspace, reports and approval history remain. No archive is created.'};}
 function cancel(token){previews.delete(token);return {cancelled:true};}
 function pin(id,pinned){ready();if(typeof pinned!=='boolean')throw Error('Invalid pin choice.');const inv=inventory(home),job=inv.jobs.find(j=>j.id===id);if(!job||job.storageRetirement)throw Error('Recovery is missing or already being released.');home.updateJob(job.agent,id,{storagePinned:pinned},{event:'human_storage_pin'});return {pinned};}
 function apply(token){
  ready();const p=previews.get(token);previews.delete(token);if(!p||p.expires<Date.now()||p.root!==path.resolve(home.root)||p.days!==days())throw Error('Release preview expired or changed.');
  const inv=inventory(home);if(inv.revision!==p.revision)throw Error('References or job revisions changed. Preview again.');
  // No await/yield from final validation to deletion: other main-process dispatch cannot interleave.
  for(const s of p.selected){const j=inv.jobs.find(j=>j.id===s.id);if(reason(j,inv,days(),Date.now())||referenced(j,s.checkpoint,inv)||digest(files(home,j,s.checkpoint,!!j.storageRetirement))!==digest(s.files))throw Error('Recovery eligibility or contents changed.');}
  const before=require('./storage-guardian').measure(home.root);if(!before.coverage.complete)throw Error('Storage coverage is incomplete; release blocked.');
  let removedLogicalBytes=0;
  for(const s of p.selected){let job=home.findJob(s.id);
   if(!job.storageRetirement){const intent={version:1,status:'prepared',at:new Date().toISOString(),origin:'human_main_window',checkpoint:s.checkpoint,files:s.files};job=home.updateJob(s.actor,s.id,{storageRetirement:intent,nativeCheckpoint:null,containment:job.containment?{...job.containment,checkpoint:null}:null},{event:'human_storage_release_prepared'});}
   afterStep('prepared',job);
   // Exact remaining tree was verified before publication. Never recursively delete an unchecked tree.
   for(const f of s.files){const current=home.p(...s.checkpoint.dir.split('/'),...f.path.split('/'));regular(current,MAX);if(hash(fs.readFileSync(current))!==f.sha256)throw Error('Release file changed; inspect the interrupted release.');fs.unlinkSync(home.p(...s.checkpoint.dir.split('/'),...f.path.split('/')));removedLogicalBytes+=f.bytes;afterStep('file_removed',job);}
   const dir=home.p(...s.checkpoint.dir.split('/'));if(fs.existsSync(dir)){const prune=d=>{for(const n of fs.readdirSync(d)){const f=path.join(d,n);directory(f);prune(f);}fs.rmdirSync(d);};prune(dir);}
   home.updateJob(s.actor,s.id,{storageRetirement:{version:1,status:'released',at:job.storageRetirement.at,releasedAt:new Date().toISOString(),origin:'human_main_window',checkpointHash:s.checkpoint.sha256,checkpointDir:s.checkpoint.dir,removedLogicalBytes:(job.storageRetirement.files||s.files).reduce((n,f)=>n+f.bytes,0)}},{event:'human_storage_released'});
  }
  const after=require('./storage-guardian').measure(home.root);
  return {removedLogicalBytes,netManagedLogicalReclaimedBytes:before.logicalBytes-after.logicalBytes,allocatedReclaimedBytes:before.allocatedBytes!==null&&after.allocatedBytes!==null?before.allocatedBytes-after.allocatedBytes:null,observedFreeBytesDelta:after.freeBytes-before.freeBytes,coverageComplete:after.coverage.complete,scope:'Measured Home before/after including receipt growth; free disk is shared and noisy. No Docker image/cache cleanup or archive savings inferred.'};
 }
 return {inspect:()=>inspect(home,{keepDays:days()}),preview,cancel,pin,apply};
}
function assertReferences(home,next){
 // Once prepared, the durable job intent fences new references even after restart.
 if(!next.nativeCheckpoint&&!next.retryIntent?.carry?.nativeCheckpoint&&!next.containment?.checkpoint&&!next.retryOf)return;
 for(const job of inventory(home).jobs){const r=job.storageRetirement;if(!r)continue;const dir=r.checkpoint?.dir||r.checkpointDir,sha=r.checkpoint?.sha256||r.checkpointHash;
  if(next.retryOf===job.id||contains({nativeCheckpoint:next.nativeCheckpoint,retryIntent:next.retryIntent,containment:next.containment},new Set([dir,sha].filter(Boolean))))throw Error('This recovery is being released or was released. References cannot reactivate it.');}
}
function register({ipcMain,isTrusted,...options}){const service=createRetention(options);for(const name of ['inspect','preview','cancel','pin','apply'])ipcMain.handle('storage:'+name,(e,...args)=>{try{if(!isTrusted(e))throw Error('Use the trusted main window.');return {ok:true,result:service[name](...args)};}catch(e){return {ok:false,error:e.message};}});return service;}
module.exports={inventory,inspect,createRetention,assertReferences,register};
