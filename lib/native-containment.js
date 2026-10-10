'use strict';
// Extend the existing Docker boundary to the entire native process. No host network,
// host write mounts, daemon socket, external commands or automatic image downloads.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{execFile,spawn}=require('child_process');
const S=require('./sandbox'),{isInside,SECRET_NAME,SECRET_DIR}=require('./fsmcp');
const MAX=1024*1024, sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const endpoint=()=>process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock';
const env=()=>Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
function docker(args,ms=20000){return new Promise(resolve=>execFile('docker',['--host',endpoint(),...args],{shell:false,env:env(),windowsHide:true,timeout:ms,maxBuffer:2*MAX},(e,stdout)=>resolve({code:e?1:0,stdout:String(stdout||'')})));}
function relative(rel){require('./job-storage').outputs([rel]);if(rel.split('/').some(s=>s.toLowerCase()==='.git'||s.toLowerCase()==='.orbit-checkpoint.json'||SECRET_NAME.test(s)||SECRET_DIR.test(s)))throw Error('Container input/output includes a protected file.');if(rel.split('/').some(s=>/[<>"|?*]/.test(s)||/[. ]$/.test(s)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))throw Error('Container path is unsafe on Windows.');return rel;}
function manifest(root){
  const list=[];let bytes=0,entries=0;
  const walk=(dir,prefix='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    if(++entries>4000)throw Error('Container workspace file bound exceeded.');if(e.name==='.git')continue;
    const rel=relative(prefix+e.name),full=path.join(dir,e.name),st=fs.lstatSync(full);
    if(st.isSymbolicLink()||(!st.isFile()&&!st.isDirectory())||(st.isFile()&&st.nlink>1))throw Error('Container workspace contains a link or special file.');
    if(st.isDirectory())walk(full,rel+'/');else{if(list.length>=2000||st.size>8*MAX||(bytes+=st.size)>64*MAX)throw Error('Container workspace byte bound exceeded.');const b=fs.readFileSync(full);list.push({path:rel,bytes:b.length,sha256:sha(b)});}
  }};walk(root);validateCandidate(list,[],false);return list.sort((a,b)=>a.path.localeCompare(b.path));
}
function workspace(home,job){
  const base=fs.realpathSync(home.p('workspace',job.agent)),root=job.workspaceDir;
  if(!root||!isInside(root,base)||path.resolve(root)===base)throw Error('Native containment requires a private current-job workspace.');
  if(job.isolation==='native_container') {
    const ownerId=job.workspaceOwnerJobId||job.id,owner=home.findJob(ownerId);
    if(!owner||owner.agent!==job.agent||path.resolve(root)!==path.resolve(home.p('workspace',job.agent,'.native',ownerId)))throw Error('Native workspace ownership changed.');
  }
  let p=base;for(const part of path.relative(base,root).split(path.sep)){p=path.join(p,part);if(fs.lstatSync(p).isSymbolicLink())throw Error('Container workspace path contains a link.');}
  if(fs.realpathSync(root)!==path.resolve(root))throw Error('Container workspace binding changed.');return root;
}
function options({name,image,root,inputDir,memoryMB=3072,cpu=2}){
  if(!/^orbit-native-[a-f0-9-]{36}$/.test(name)||!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('Choose an installed immutable native image ID (sha256: plus 64 hex characters).');
  const helper=path.join(__dirname,'native-container-runner.js');
  const source=inputDir||root;
  if([source,helper].some(p=>/[\x00-\x1f,]/.test(p)))throw Error('Container mount path is unsupported.');
  return ['create','--name',name,'--pull','never','--network','none','--ipc','private','--cgroupns','private','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges=true','--user','10001:10001','--pids-limit','128','--memory',memoryMB+'m','--memory-swap',memoryMB+'m','--cpus',String(cpu),'--init','--no-healthcheck','--restart','no','--log-driver','none','-i','--label','orbit.native.version=1','--label','orbit.native.owner='+name,
    '--mount','type=bind,src='+source+',dst=/input,readonly', '--mount','type=bind,src='+helper+',dst=/orbit-runtime.js,readonly',
    '--tmpfs','/workspace:rw,nosuid,nodev,size=128m,mode=0700,uid=10001,gid=10001','--tmpfs','/home/orbit:rw,nosuid,nodev,size=128m,mode=0700,uid=10001,gid=10001','--tmpfs','/tmp:rw,nosuid,nodev,size=64m,mode=1777',
    '--env','HOME=/home/orbit','--env','PATH=/usr/local/bin:/usr/bin:/bin','--env','NODE_OPTIONS=','--entrypoint','/usr/local/bin/node',image,'/orbit-runtime.js'];
}
function mountPath(p,platform=process.platform){let s=String(p).replace(/\\/g,'/');if(platform==='win32'){s=s.replace(/^\/(?:run\/desktop\/mnt\/host|host_mnt|mnt\/host)\/([a-z])\//i,'$1:/');return s.toLowerCase();}return path.resolve(s);}
function verify(info,state){
  const h=info.HostConfig||{},c=info.Config||{},m=info.Mounts||[], expected=[['/input',state.inputDir||state.root],['/orbit-runtime.js',path.join(__dirname,'native-container-runner.js')]];
  if(info.Image!==state.image||c.Labels?.['orbit.native.owner']!==state.name||c.Labels?.['orbit.native.version']!=='1'||c.User!=='10001:10001'||h.Privileged||h.NetworkMode!=='none'||h.PidMode||h.IpcMode!=='private'||!h.ReadonlyRootfs||!h.CapDrop?.includes('ALL')||h.CapAdd?.length||!h.SecurityOpt?.some(s=>/^no-new-privileges(=true)?$/.test(s))||h.SecurityOpt?.some(s=>/unconfined/.test(s))||h.PidsLimit!==128||h.Memory!==state.memoryMB*MAX||h.MemorySwap!==state.memoryMB*MAX||h.NanoCpus!==state.cpu*1e9||h.Devices?.length||h.DeviceRequests?.length||h.PortBindings&&Object.keys(h.PortBindings).length||m.length!==2)throw Error('Docker did not enforce the required native containment policy.');
  for(const [dest,src] of expected)if(!m.some(x=>x.Type==='bind'&&x.Destination===dest&&x.RW===false&&mountPath(x.Source)===mountPath(src)))throw Error('Container mounts differ from the current job policy.');
  if(Object.keys(h.Tmpfs||{}).sort().join('|')!=='/home/orbit|/tmp|/workspace')throw Error('Unexpected container scratch mounts.');
}
async function inspect(run,name){const r=await run(['inspect',name]);if(r.code)throw Error('Docker container state cannot be confirmed.');const a=JSON.parse(r.stdout);if(a.length!==1)throw Error('Invalid container inspection.');return a[0];}
async function stopOwned(run,state){
  let info;try{info=await inspect(run,state.name);}catch{
    const check=await run(['container','ls','-a','--filter','name=^/'+state.name+'$','--format','{{.ID}}']);if(check.code===0&&!check.stdout.trim())return;throw Error('Container cleanup is unknown; restore Docker before retry.');
  }
  if(info.Config?.Labels?.['orbit.native.owner']!==state.name||info.Image!==state.image)throw Error('Container cleanup identity does not match; no unrelated container was stopped.');
  if(info.State?.Running){await run(['kill',state.name]);info=await inspect(run,state.name);if(info.State?.Running)throw Error('Native container remains running; this worker is blocked.');}
  const rm=await run(['rm',state.name]);if(rm.code)throw Error('Native container removal was not confirmed.');
}
function validateCandidate(files,initial,reviewer){
  if(!Array.isArray(files)||files.length>2000)throw Error('Invalid container output manifest.');const seen=new Set();let bytes=0;
  for(const f of files){relative(f.path);const key=f.path.toLowerCase();if(seen.has(key)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>8*MAX||! /^[a-f0-9]{64}$/.test(f.sha256)||(bytes+=f.bytes)>64*MAX)throw Error('Unsafe container output manifest.');seen.add(key);}
  if(reviewer&&JSON.stringify(files.filter(f=>f.path.startsWith('source/')).sort((a,b)=>a.path.localeCompare(b.path)))!==JSON.stringify(initial.filter(f=>f.path.startsWith('source/'))))throw Error('Independent review source was modified inside the container.');
  for(const f of files)for(const other of files)if(other.path.toLowerCase().startsWith(f.path.toLowerCase()+'/'))throw Error('Output paths overlap as file and directory.');
}
async function start({home,job,agent,engine,cfg,broker,gateway,signal,runs,run,runner=docker,spawnImpl=spawn,fetchImpl=global.fetch}){
  runs.assert(run);signal.throwIfAborted();if(!broker)throw Error('OS-contained native jobs require the host model broker.');
  const root=workspace(home,job),input=manifest(root),image=cfg.nativeContainerImage;
  if(gateway&&(typeof gateway.token!=='string'||!gateway.token||!/^http:\/\/127\.0\.0\.1:\d+\/mcp\/[a-z0-9-]+$/.test(gateway.url)||new URL(gateway.url).pathname!=='/mcp/'+job.agent))throw Error('Native gateway is not bound to this worker.');
  const settings=S.normalize(agent.sandbox),state={version:1,name:'orbit-native-'+crypto.randomUUID(),image,root,runId:run.runId,memoryMB:settings.memoryMB,cpu:settings.cpu,status:'starting'};
  state.inputDir=home.p('native-inputs',state.name);
  const args=options(state),info=await runner(['info','--format','{{.OSType}}']);if(info.code||info.stdout.trim()!=='linux')throw Error('Native OS containment requires running local Docker Linux containers.');
  const available=await runner(['image','inspect',image]);if(available.code)throw Error('Native runtime image is not installed. No image was pulled; select an approved image first.');
  const imageInfo=JSON.parse(available.stdout)[0];if(imageInfo.Id!==image||Object.keys(imageInfo.Config?.Volumes||{}).length||imageInfo.Config?.Env?.some(s=>S.SECRETISH.test(s.split('=')[0])&&s.slice(s.indexOf('=')+1)))throw Error('Native image must have no inherited secret variables or declared volumes.');
  const save=status=>{const j=home.findJob(job.id);home.updateJob(job.agent,job.id,{containment:{...state,status},...(state.checkpoint?{nativeCheckpoint:state.checkpoint}:{})},{expectedRunId:run.runId,expectedStatus:j.status,event:'native_container_'+status});state.status=status;};
  save('starting');let proc,closed=false,failed,closePromise;
  const close=()=>closePromise||(closePromise=(async()=>{try{await stopOwned(runner,state);closed=true;save('stopped');fs.rmSync(state.inputDir,{recursive:true,force:true});}catch(e){try{save('cleanup_unknown');}catch{}home.recoveryFaults?.set(job.agent,'Native container cleanup is unknown. Restore Docker and reconcile before retrying this worker.');throw e;}})());
  try{
    fs.mkdirSync(home.p('native-inputs'),{recursive:true,mode:0o700});
    fs.mkdirSync(state.inputDir,{mode:0o755});
    for(const f of input){const b=fs.readFileSync(path.join(root,...f.path.split('/')));if(b.length!==f.bytes||sha(b)!==f.sha256)throw Error('Input changed before containment.');const dest=path.join(state.inputDir,...f.path.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b,{flag:'wx',mode:0o644});}
    const created=await runner(args);if(created.code)throw Error('Native container creation failed; no host fallback was started.');
    runs.assert(run);signal.throwIfAborted();verify(await inspect(runner,state.name),state);save('isolated');
  }catch(e){await close().catch(()=>{});throw e;}
  let executing=false;
  return {close,state,async execute(task,{onProgress,onText,onData,onTransport,onUsage}={}){
    if(executing||closed)throw Error('Container execution is single-use.');executing=true;runs.assert(run);signal.throwIfAborted();
    const stageRoot=home.p('native-candidates',job.id+'-'+run.runId);fs.mkdirSync(stageRoot,{recursive:true,mode:0o700});let stage,candidate,batchKind,total=0,wireBytes=0,frames=0,buffer='',stdout='',text='',completion,ready=false,finalComplete=false,bytesByFile=new Map();
    const commitCheckpoint=()=>{
      if(!candidate)throw Error('Missing checkpoint manifest.');
      for(const f of candidate){const file=path.join(stage,...f.path.split('/'));if(!fs.existsSync(file)&&f.bytes===0)fs.writeFileSync(file,'',{mode:0o600});if((bytesByFile.get(f.path)||0)!==f.bytes||sha(fs.readFileSync(file))!==f.sha256)throw Error('Candidate bytes do not match their manifest.');const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
      const dirs=new Set([stage]);for(const f of candidate){let dir=path.dirname(path.join(stage,...f.path.split('/')));while(dir!==stage){dirs.add(dir);dir=path.dirname(dir);}}
      for(const dir of [...dirs].sort((a,b)=>b.length-a.length)){let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd);}catch(e){if(process.platform!=='win32')throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}}
      const data={version:1,actor:job.agent,jobId:job.id,runId:run.runId,root,input,files:candidate};require('./job-storage').atomicWrite(path.join(stage,'.orbit-checkpoint.json'),data);
      // Persist newly created snapshot directory entries before publishing the job pointer.
      for(let dir=path.resolve(stageRoot);;dir=path.dirname(dir)){let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd);}catch(e){if(process.platform!=='win32')throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}if(dir===path.resolve(home.root))break;if(dir===path.dirname(dir))throw Error('Checkpoint directory is outside its home.');}
      const old=state.checkpoint;state.checkpoint={version:1,actor:job.agent,jobId:job.id,runId:run.runId,root,dir:path.relative(home.root,stage).split(path.sep).join('/'),sha256:sha(Buffer.from(JSON.stringify(data))),at:new Date().toISOString()};
      save(state.status);
      if(old?.dir&&old.dir.startsWith(path.relative(home.root,stageRoot).split(path.sep).join('/')+'/'))fs.rmSync(home.p(...old.dir.split('/')),{recursive:true,force:true});
    };
    const collector=engine==='opencode'?require('./ocevents').makeCollector({onProgress,onText}):null;
    const parse=engine==='hermes'?require('./hermes').makeSseParser(({event,data})=>{if(data==='[DONE]')return;let j;try{j=JSON.parse(data);}catch{return;}if(event==='hermes.tool.progress')onProgress?.({tool:j.tool,label:j.label,status:j.status,id:j.toolCallId});if(j.error)throw Error('Isolated Hermes returned an error.');if(j.usage)onUsage?.(j.usage);const t=j.choices?.[0]?.delta?.content;if(t){text+=t;onText?.(text);}}):null;
    const send=m=>{if(proc?.stdin.destroyed||signal.aborted)throw Error('Contained request expired.');proc.stdin.write(JSON.stringify(m)+'\n');};
    const frame=async m=>{
      runs.assert(run);signal.throwIfAborted();
      if(finalComplete)throw Error('Runtime emitted events after its final candidate.');
      if(m.type==='ready'){if(ready)throw Error('Duplicate runtime initialization.');ready=true;send({type:'init',engine,input,config:{workerModel:broker.override.workerModel,gateway:!!gateway},token:broker.override.workerApiKey,task:String(task).split(root).join('/workspace'),system:require('./persona').buildAgentPrompt(cfg,home,{...agent,workspaceDir:'/workspace'})});}
      else if(m.type==='broker'||m.type==='gateway'){
        const isGateway=m.type==='gateway';
        if(!ready||!Number.isSafeInteger(m.id)||typeof m.body!=='string'||Buffer.byteLength(m.body)>(isGateway?256*1024:MAX)||(isGateway?(!gateway||m.path!=='/mcp'||m.method!=='POST'):(!['/v1/chat/completions','/v1/models'].includes(m.path)||!['GET','POST'].includes(m.method))))throw Error('Invalid isolated broker request.');
        if(isGateway){const rpc=JSON.parse(m.body),batch=Array.isArray(rpc)?rpc:[rpc];if(!batch.length||batch.length>20||batch.some(x=>!x||x.jsonrpc!=='2.0'||typeof x.method!=='string'))throw Error('Invalid contained gateway message.');if(job.reviewTarget&&batch.some(x=>x.method==='tools/call'&&!/^(read|glob|grep|list|search)/i.test(x.params?.name||'')))throw Error('Independent reviewer gateway action is not read-only.');}
        const res=await fetchImpl(isGateway?gateway.url:broker.override.workerBaseUrl.replace(/\/v1$/,'')+m.path,{method:m.method,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(420000)]),headers:{Authorization:'Bearer '+(isGateway?gateway.token:broker.override.workerApiKey),'Content-Type':'application/json'},...(m.method==='POST'?{body:m.body}:{})});
        const data=[];let n=0;for await(const c of res.body){if((n+=c.length)>4*MAX)throw Error('Isolated broker response bound.');data.push(c);}send({type:'reply',id:m.id,status:res.status,contentType:res.headers.get('content-type')||'application/json',body:Buffer.concat(data).toString('base64')});
      }else if(m.type==='stdout'||m.type==='sse'){
        const b=Buffer.from(m.data,'base64');if((total+=b.length)>4*MAX)throw Error('Native report exceeded its bound.');onData?.(b.length);onTransport?.({kind:'received',source:'contained_'+engine,bytes:b.length});if(collector){stdout+=b.toString();collector.push(b);}else parse(b.toString());
      }else if(m.type==='manifest'){if(candidate)throw Error('Duplicate candidate.');validateCandidate(m.files,input,!!job.reviewTarget);candidate=m.files;batchKind=m.kind||'final';if(!['checkpoint','final'].includes(batchKind))throw Error('Invalid snapshot kind.');stage=path.join(stageRoot,crypto.randomUUID());fs.mkdirSync(stage,{mode:0o700});bytesByFile=new Map();}
      else if(m.type==='file'){
        const f=candidate?.find(f=>f.path===m.path),b=Buffer.from(m.data,'base64'),offset=bytesByFile.get(m.path)||0;
        if(!f||m.offset!==offset||b.length>192*1024||offset+b.length>f.bytes)throw Error('Invalid candidate data.');const dest=path.join(stage,...relative(m.path).split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.appendFileSync(dest,b,{mode:0o600});bytesByFile.set(m.path,offset+b.length);
      }else if(m.type==='complete'){if(!candidate||(m.kind||'final')!==batchKind)throw Error('Missing candidate manifest.');commitCheckpoint();wireBytes=0;frames=0;if(batchKind==='checkpoint'){candidate=null;}else {finalComplete=true;completion();}}
      else if(m.type==='version'){if(engine==='opencode'&&!/^(?:OpenCode\s+)?1\./i.test(m.version||''))throw Error('Unsupported contained OpenCode version.');}
      else if(m.type!=='stderr')throw Error('Isolated runtime failed.');
    };
    let chain=Promise.resolve(),rejectDone;const done=new Promise((resolve,reject)=>{completion=resolve;rejectDone=reject;});
    const abort=()=>rejectDone(signal.reason||Error('Native job stopped.'));signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>rejectDone(Error('Contained native execution deadline exceeded.')),Math.min((cfg.workerTimeoutSeconds||1800)*1000,86400000));timeout.unref?.();
    try{
      proc=spawnImpl('docker',['--host',endpoint(),'start','-a','-i',state.name],{shell:false,env:env(),windowsHide:true,stdio:['pipe','pipe','pipe']});
      proc.stdin.on('error',rejectDone);proc.on('error',rejectDone);proc.on('close',()=>{chain.then(()=>{if(!finalComplete)rejectDone(Error('Native container exited before a complete candidate.'));},rejectDone);});proc.stderr.on('data',()=>{});
      proc.stdout.on('data',chunk=>{wireBytes+=chunk.length;buffer+=chunk;if(wireBytes>128*MAX||buffer.length>4*MAX)return rejectDone(Error('Container protocol exceeded its bound.'));let i;while((i=buffer.indexOf('\n'))>=0){if(++frames>8192)return rejectDone(Error('Container protocol event bound exceeded.'));const line=buffer.slice(0,i);buffer=buffer.slice(i+1);chain=chain.then(()=>frame(JSON.parse(line))).catch(e=>{failed=e;rejectDone(e);});}});
      await done;await chain;if(failed)throw failed;await close();broker.assertHealthy();runs.assert(run);signal.throwIfAborted();
      if(JSON.stringify(manifest(root))!==JSON.stringify(input))throw Error('Workspace changed during isolated execution; candidate was not applied.');
      // Validate the entire candidate before touching the current job workspace.
      for(const f of input.filter(f=>!candidate.some(n=>n.path===f.path)))fs.unlinkSync(path.join(root,...f.path.split('/')));
      for(const f of candidate){const dest=path.join(root,...f.path.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});const temp=dest+'.orbit-'+crypto.randomUUID()+'.tmp';fs.copyFileSync(path.join(stage,...f.path.split('/')),temp,fs.constants.COPYFILE_EXCL);fs.renameSync(temp,dest);}
      save('stopped');if(collector){collector.end();return collector.text()||stdout.trim();}return text.trim();
    }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);try{await close();}finally{try{proc?.kill();}catch{}for(const name of fs.readdirSync(stageRoot)){const dir=path.join(stageRoot,name);if(path.relative(home.root,dir).split(path.sep).join('/')!==state.checkpoint?.dir)fs.rmSync(dir,{recursive:true,force:true});}}}
  }};
}
async function reconcile(home,runner=docker){
  for(const agent of home.listAgents())for(const job of home.listJobs(agent.id,10000))if(job.containment&&job.containment.status!=='stopped'){
    try{await stopOwned(runner,job.containment);home.updateJob(agent.id,job.id,{containment:{...job.containment,status:'stopped'}},{expectedStatus:job.status,event:'native_container_restart_cleanup'});if(job.containment.inputDir===home.p('native-inputs',job.containment.name))fs.rmSync(job.containment.inputDir,{recursive:true,force:true});const fault=home.recoveryFaults.get(agent.id);if(fault?.startsWith('Native container cleanup'))home.recoveryFaults.delete(agent.id);}
    catch{home.recoveryFaults.set(agent.id,'Native container cleanup is unknown. Restore Docker and reconcile before retrying this worker.');}
  }
}
function restoreCheckpoint(home,job){
  const p=job.nativeCheckpoint;if(!p)return;
  let owner=job;for(let i=0;owner&&owner.id!==p.jobId&&i<100;i++)owner=home.findJob(owner.retryOf);
  if(!owner||owner.id!==p.jobId||owner.agent!==job.agent||p.actor!==job.agent||p.root!==job.workspaceDir||!/^native-candidates\/job-[a-f0-9-]+-[a-f0-9-]+\/[a-f0-9-]{36}$/.test(p.dir))throw Error('Native checkpoint binding changed.');
  const dir=home.p(...p.dir.split('/')),file=path.join(dir,'.orbit-checkpoint.json');let part=home.root;for(const name of p.dir.split('/')){part=path.join(part,name);if(fs.lstatSync(part).isSymbolicLink())throw Error('Native checkpoint path contains a link.');}
  const st=fs.lstatSync(file);if(!st.isFile()||st.nlink!==1)throw Error('Native checkpoint metadata is not a private regular file.');
  const data=JSON.parse(fs.readFileSync(file));if(sha(Buffer.from(JSON.stringify(data)))!==p.sha256||data.actor!==job.agent||data.root!==job.workspaceDir||data.jobId!==p.jobId||data.runId!==p.runId)throw Error('Native checkpoint integrity changed.');
  validateCandidate(data.input,[],false);validateCandidate(data.files,data.input,!!job.reviewTarget);const current=manifest(workspace(home,job));
  for(const f of current){const before=data.input.find(x=>x.path===f.path),after=data.files.find(x=>x.path===f.path);if(f.sha256!==before?.sha256&&f.sha256!==after?.sha256)throw Error('Workspace conflicts with the native checkpoint; inspect before restoring.');}
  for(const f of data.input)if(!current.some(x=>x.path===f.path)&&data.files.some(x=>x.path===f.path))throw Error('Native checkpoint restore found an unexplained missing input file.');
  for(const f of data.files){const source=path.join(dir,...relative(f.path).split('/'));if(fs.lstatSync(source).isSymbolicLink()||sha(fs.readFileSync(source))!==f.sha256)throw Error('Native checkpoint data changed.');}
  for(const f of current.filter(f=>!data.files.some(n=>n.path===f.path)))fs.unlinkSync(path.join(job.workspaceDir,...f.path.split('/')));
  for(const f of data.files){const dest=path.join(job.workspaceDir,...f.path.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});const temp=dest+'.orbit-'+crypto.randomUUID()+'.tmp';fs.copyFileSync(path.join(dir,...f.path.split('/')),temp,fs.constants.COPYFILE_EXCL);fs.renameSync(temp,dest);}
}
async function checkRuntime(cfg,engine,runner=docker){
  const fs=require('fs'),os=require('os');let root,state,created=false;
  try{
    if(!['hermes','opencode'].includes(engine))throw Error('Unsupported native engine.');
    state={name:'orbit-native-'+crypto.randomUUID(),image:cfg.nativeContainerImage,memoryMB:3072,cpu:2};
    // Validate before creating any local files or probing Docker.
    options({...state,root:os.tmpdir()});
    const ready=await runner(['info','--format','{{.OSType}}']);if(ready.code||ready.stdout.trim()!=='linux')throw Error('Local Docker Linux engine is unavailable.');
    const im=await runner(['image','inspect',state.image]);if(im.code)throw Error('Approved native image is not installed; no image was pulled.');const imageInfo=JSON.parse(im.stdout)[0];if(imageInfo.Id!==state.image||Object.keys(imageInfo.Config?.Volumes||{}).length||imageInfo.Config?.Env?.some(s=>S.SECRETISH.test(s.split('=')[0])&&s.slice(s.indexOf('=')+1)))throw Error('Native image includes secret environment variables or declared volumes.');
    root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-native-check-'));state.root=path.join(root,'input');fs.mkdirSync(state.root);fs.writeFileSync(path.join(root,'canary.txt'),'synthetic');
    const args=options(state);args.push('--isolation-check',path.join(root,'canary.txt'),'0',engine);const made=await runner(args);if(made.code)throw Error('Native runtime check could not create a container.');created=true;
    verify(await inspect(runner,state.name),state);const ran=await runner(['start','-a',state.name],40000);let report;for(const line of ran.stdout.split('\n')){try{const m=JSON.parse(line);if(m.type==='isolation')report=m;}catch{}}
    if(ran.code||!report||!Object.values(report.checks).every(Boolean))throw Error('Container isolation or selected CLI check failed.');
    return {ok:true,version:report.cliVersion,checks:report.checks,scope:'Docker isolation and CLI version; no provider call or task execution.'};
  }catch(e){return {ok:false,error:e.message};}
  finally{try{if(created)await stopOwned(runner,state);}finally{if(root)fs.rmSync(root,{recursive:true,force:true});}}
}
module.exports={start,reconcile,options,verify,manifest,validateCandidate,workspace,stopOwned,docker,mountPath,restoreCheckpoint,checkRuntime};
