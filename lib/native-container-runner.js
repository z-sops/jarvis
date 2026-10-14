'use strict';
// Runs ONLY inside the isolated image. The protocol exposes no arbitrary host URL or command.
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto'),cp=require('child_process');
const MAX=1024*1024, pending=new Map(); let started=false, seq=0, child, lastSnapshot,phase='initialization',issue='unknown',stateInit,activeAcp;
const diagnosticCodes=[];
const emit=x=>process.stdout.write(JSON.stringify(x)+'\n');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
// Standalone mounted helper has Node built-ins only. Writes are inside kernel-
// bounded tmpfs; host admission/checkpoint accounting remains in containment.
function writeRuntimeFile(file,data){fs.writeFileSync(file,data);}
function classifyRuntimeIssue(text){text=String(text).slice(0,16384);if(/ModuleNotFoundError|ImportError|No module named/.test(text))return 'missing_dependency';if(/Read-only file system|EROFS/.test(text))return 'readonly_runtime_write';if(/PermissionError|Permission denied|EACCES/.test(text))return 'permission_denied';if(/Unexpected content type|invalid initialize result|protocol version is not supported|Invalid response|JSON.*(?:parse|invalid)/i.test(text))return 'mcp_invalid_response';if(/timed?\s*out|timeout/i.test(text))return 'runtime_timeout';if(/No messaging platforms enabled/i.test(text))return 'api_platform_missing';if(/Failed to start API server|api_server_key_invalid|Could not bind/i.test(text))return 'api_start_failed';if(/MCP.*(?:failed|error|unavailable)|Error POSTing to endpoint/i.test(text))return 'mcp_connection';if(/\b(?:401|403)\b|unauthorized|invalid api.?key|authentication required/i.test(text))return 'provider_authentication';if(/\b429\b|rate.?limit|quota exceeded/i.test(text))return 'provider_rate_limit';if(/ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|network error/i.test(text))return 'provider_network';return 'unknown';}
function stderr(data){const found=classifyRuntimeIssue(String(data));if(found!=='unknown'){issue=found;diagnosticCodes.push(found);if(diagnosticCodes.length>20)diagnosticCodes.shift();}} // Never return native logs/paths/credentials.
function setPhase(value){phase=value;emit({type:'runtime_phase',phase});}
function fail(error){if(issue==='unknown'&&error?.message)issue=classifyRuntimeIssue(error.message);emit({type:'failure',phase,issue,diagnosticCodes:[...diagnosticCodes],exitCode:Number.isInteger(child?.exitCode)?child.exitCode:null});process.exit(1);}
function relayPolicy(url,method,authorized,gateway){if(!authorized)return 401;if(url==='/mcp'&&gateway)return method==='POST'?200:405;return ['/v1/chat/completions','/v1/models'].includes(url)&&['GET','POST'].includes(method)?200:400;}
function mcpStatus(text){const clean=String(text).replace(/\x1b\[[0-9;]*m/g,'');for(const status of ['needs authentication','needs client registration','not initialized','disabled','failed','connected'])if(new RegExp('\\borbit\\s+'+status+'\\b').test(clean))return status==='connected'?'connected':status==='failed'?'failed':'unavailable';return 'unknown';}
// Transport metadata only. Never a credential, approval or actor identity.
function nativeClientHeaders(headers={}){
  if(!headers||typeof headers!=='object'||Array.isArray(headers))throw Error('Invalid native metadata');
  const out={};for(const name of ['user-agent','x-opencode-session','x-opencode-request','x-opencode-client','x-opencode-project','x-opencode-session-id']){
    const value=headers[name];if(value===undefined)continue;
    if(typeof value!=='string'||value.length>256||!value.length||!/^[\x20-\x7e]+$/.test(value))throw Error('Native metadata bound');
    if(name==='user-agent'&&!/^opencode\/\d+\.\d+\.\d+(?:[ ;].*)?$/.test(value))throw Error('Invalid native client version');
    if(name!=='user-agent'&&!/^[a-zA-Z0-9._-]+$/.test(value))throw Error('Invalid native client identifier');
    out[name]=value;
  }return out;
}
function nativeProviderConfig(model,baseURL,token,native=false){
  const id=native?'opencode':'custom';return {id,model:id+'/'+model,provider:{[id]:{npm:'@ai-sdk/openai-compatible',name:native?'OpenCode via Orbit relay':'Orbit isolated broker',options:{baseURL,apiKey:token},models:{[model]:{name:model}}}}};
}
function createRelay(init,{requests=pending,checkpoint=()=>output('checkpoint'),send=emit}={}){
  let active=0;
  return http.createServer(async(req,res)=>{try{
    const gateway=req.url==='/mcp',status=relayPolicy(req.url,req.method,req.headers.authorization==='Bearer '+init.token,init.config.gateway);if(status!==200){res.writeHead(status,status===405?{Allow:'POST'}:{});return res.end('Unsupported isolated request');}
    if(active>=8||requests.size>=8){res.writeHead(429);return res.end('Isolated relay capacity reached');}active++;res.once('close',()=>active--);
    let body='',n=0;for await(const c of req){n+=c.length;if(n>MAX)throw Error('Relay bound');body+=c;}
    if(res.destroyed)throw Error('Relay closed');const headers=!gateway&&req.method==='POST'&&req.url==='/v1/chat/completions'&&init.engine==='opencode'&&init.config.nativeClient?nativeClientHeaders(req.headers):null;checkpoint();const id=++seq;const timer=setTimeout(()=>{requests.delete(id);res.destroy();},420000);requests.set(id,{res,timer});send({type:gateway?'gateway':'broker',id,method:req.method,path:req.url,body,...(headers?{headers}:{})});
  }catch{if(!res.headersSent)res.writeHead(400);res.end('Unsupported isolated request');}});
}
function requestNativePermission(params){
  if(pending.size>=8)return Promise.resolve(null);
  const id=++seq;return new Promise(resolve=>{const timer=setTimeout(()=>{pending.delete(id);resolve(null);},120000);pending.set(id,{permission:resolve,timer});emit({type:'native_permission',id,params});});
}
function nativePermissionReply(m,requests=pending){const p=requests.get(m.id);if(!p?.permission)throw Error('Missing native permission');requests.delete(m.id);clearTimeout(p.timer);p.permission(typeof m.optionId==='string'?m.optionId:null);}
function relayReply(m,requests=pending){const p=requests.get(m.id);if(!p)throw Error('Missing request');requests.delete(m.id);clearTimeout(p.timer);p.res.writeHead(m.status,{'Content-Type':m.contentType});p.res.end(Buffer.from(m.body,'base64'));}
function hermesStartupDetails(dir){
  const read=(name)=>{let fd;try{const file=path.join(dir,name),st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)return '';fd=fs.openSync(file,'r');const b=Buffer.alloc(Math.min(st.size,65536));const n=fs.readSync(fd,b,0,b.length,Math.max(0,st.size-b.length));return b.subarray(0,n).toString('utf8');}catch{return '';}finally{if(fd!==undefined)fs.closeSync(fd);}};
  let status={};try{status=JSON.parse(read('gateway_state.json'));}catch{}
  const states=['starting','running','degraded','stopped','startup_failed','connecting','connected','retrying','disconnected','fatal'];
  const api=status.platforms?.api_server,details={gatewayState:states.includes(status.gateway_state)?status.gateway_state:'unknown',apiPresent:!!api,apiState:states.includes(api?.state)?api.state:'unknown',apiError:['adapter_unavailable','api_server_key_invalid','api_server_port_in_use','connect_failed','connect_timeout'].includes(api?.error_code)?api.error_code:'unknown'};
  const logs=['logs/gateway.log','logs/agent.log','logs/errors.log'].map(read).join('\n');
  details.startupMilestones={mcpRegistered:/MCP server 'orbit'.*registered \d+ tool/.test(logs),gatewayStarting:/Starting Hermes Gateway/.test(logs),apiListening:/API server listening/.test(logs),gatewayRunning:/Gateway running/.test(logs)};
  details.logIssue=classifyRuntimeIssue(logs);return details; // No raw status/log text leaves the container.
}
function cleanEnv(){return {PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/home/orbit',XDG_CONFIG_HOME:'/home/orbit/config',XDG_DATA_HOME:'/home/orbit/data',XDG_CACHE_HOME:'/home/orbit/cache',XDG_STATE_HOME:'/home/orbit/state',OPENCODE_DB:'/home/orbit/data/opencode/opencode.db',PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',HERMES_HOME:'/home/orbit/hermes'};}
function privateState(mode,init=stateInit){
  // Until the fresh authenticated response identifies its session, do not guess from other rows.
  if(mode==='capture'&&(init.engine==='hermes'||init.config?.opencodeTransport==='acp')&&!init.nativeSessionId)return {version:1,adapter:1,engine:init.engine,files:[],sessionId:null,pendingEffects:0,retiredQueueRows:0};
  const p=cp.spawnSync('/opt/hermes/.venv/bin/python',['-I','-B','-c',init.stateHelper,init.engine,mode,'/home/orbit',...(init.nativeSessionId?[init.nativeSessionId]:[])],{env:cleanEnv(),cwd:'/workspace',input:mode==='restore'?JSON.stringify(init.privateRestore):undefined,encoding:'utf8',timeout:10000,maxBuffer:16*MAX});
  if(p.error||p.status!==0){issue='native_state_invalid';throw Error('Private native state failed');}return JSON.parse(p.stdout);
}
function output(kind='final'){
  const files=[];let bytes=0;
  const walk=(dir,prefix='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const rel=prefix+e.name,full=path.join(dir,e.name),st=fs.lstatSync(full);
    if(st.isSymbolicLink()||(!st.isFile()&&!st.isDirectory())||(st.isFile()&&st.nlink>1))throw Error('Unsafe output');
    if(e.name==='.git')continue;
    if(st.isDirectory())walk(full,rel+'/');else{if(files.length>=2000||st.size>8*MAX||(bytes+=st.size)>64*MAX)throw Error('Output bound');const b=fs.readFileSync(full);files.push({path:rel,sha256:hash(b),bytes:b.length,data:b});}
  }};walk('/workspace');
  const native=stateInit?.stateHelper?privateState('capture'):null;
  if(kind==='final'&&native&&!native.sessionId){issue='native_state_invalid';throw Error('Final native session was not persisted');}
  const engineState=native?{...native,files:native.files.map(({data,...f})=>f)}:undefined;
  const summary=files.map(({data,...f})=>f).sort((a,b)=>a.path.localeCompare(b.path)),digest=hash(Buffer.from(JSON.stringify([summary,native])));
  if(kind==='checkpoint'&&digest===lastSnapshot)return;
  emit({type:'manifest',kind,files:summary,...(engineState?{engineState}:{})});
  for(const f of native?.files||[]){const b=Buffer.from(f.data,'base64');for(let offset=0;offset<b.length;offset+=192*1024)emit({type:'private_file',path:f.path,offset,data:b.subarray(offset,offset+192*1024).toString('base64')});}
  for(const f of files){const b=f.data;for(let offset=0;offset<b.length;offset+=192*1024)emit({type:'file',path:f.path,offset,data:b.subarray(offset,offset+192*1024).toString('base64')});}
  emit({type:'complete',kind});lastSnapshot=digest;
}
async function run(init){
  if(started||!['hermes','opencode'].includes(init.engine)||!Array.isArray(init.input))throw Error('Invalid initialization');started=true;
  const env=cleanEnv();fs.mkdirSync(env.HOME,{recursive:true});stateInit=init;
  if((init.engine==='hermes'||init.config?.opencodeTransport==='acp')&&init.stateHelper)init.nativeSessionId=init.privateRestore?.sessionId||null;
  if(init.stateHelper){if(typeof init.stateHelper!=='string'||Buffer.byteLength(init.stateHelper)>32768)throw Error('State helper bound');if(init.privateRestore)privateState('restore',init);}
  for(const f of init.input){if(!/^[^\x00-\x1f]+$/.test(f.path)||f.path.split('/').some(s=>!s||s==='.'||s==='..')||f.path.startsWith('/'))throw Error('Input path');const b=fs.readFileSync('/input/'+f.path);if(hash(b)!==f.sha256)throw Error('Input changed');const dst='/workspace/'+f.path;fs.mkdirSync(path.dirname(dst),{recursive:true});writeRuntimeFile(dst,b);}
  const relay=createRelay(init);
  await new Promise(r=>relay.listen(8081,'127.0.0.1',r));
  const config={...init.config,workerProvider:'custom',workerApiKey:init.token,workerBaseUrl:'http://127.0.0.1:8081/v1'};
  setPhase('cli_version');const version=cp.spawnSync(init.engine,['--version'],{env,cwd:'/workspace',encoding:'utf8',timeout:30000,maxBuffer:65536});
  if(version.status!==0||init.engine==='opencode'&&!/^(?:OpenCode\s+)?1\./i.test(version.stdout.trim()))throw Error('Unsupported image CLI');
  if(init.stateHelper&&!(init.engine==='opencode'?/^(?:OpenCode\s+)?1\.18\.35\s*$/i:/^Hermes Agent v0\.21\.6\b/).test(version.stdout.trim())){issue='native_state_invalid';throw Error('Unsupported private state adapter version');}
  emit({type:'version',version:String(version.stdout).split('\n')[0].slice(0,120)});
  const checkpointTimer=setInterval(()=>{try{output('checkpoint');}catch{fail();}},10000);checkpointTimer.unref();
  if(init.engine==='opencode'){
    if(!['run','acp'].includes(init.config.opencodeTransport||'run'))throw Error('Invalid OpenCode transport');
    if(init.config.opencodeTransport==='acp'&&!/^(?:OpenCode\s+)?1\.18\.35\s*$/.test(version.stdout.trim()))throw Error('ACP adapter requires pinned OpenCode1.18.35');
    const model=config.workerModel,permission={'*':'deny',read:'allow',glob:'allow',grep:'allow',edit:'allow',bash:'deny',external_directory:'deny'};
    const instructions=env.HOME+'/orbit-instructions.md';writeRuntimeFile(instructions,init.system||'Work only in /workspace. Report evidence.');
    const selected=nativeProviderConfig(model,config.workerBaseUrl,init.token,init.config.nativeClient===true);
    if(init.config.nativeClient&&init.config.opencodeTransport==='acp')permission.bash='ask';
    const cfg={model:selected.model,small_model:selected.model,...opencodeMediationPolicy(),autoupdate:false,instructions:[instructions],enabled_providers:[selected.id],provider:selected.provider,permission};
    if(init.config.gateway){cfg.mcp={orbit:{type:'remote',url:'http://127.0.0.1:8081/mcp',headers:{Authorization:'Bearer '+init.token},oauth:false,enabled:true}};permission['orbit_*']='allow';}
    const file=env.HOME+'/opencode.json';writeRuntimeFile(file,JSON.stringify(cfg));env.OPENCODE_CONFIG=file;env.OPENCODE_CONFIG_CONTENT=JSON.stringify(cfg);env.OPENCODE_PERMISSION=JSON.stringify(permission);
    if(init.config.gateway){
      setPhase('opencode_mcp');let logs='';
      const code=await new Promise((resolve,reject)=>{child=cp.spawn('opencode',['mcp','list'],{env,cwd:'/workspace',stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>{child.kill('SIGTERM');issue='runtime_timeout';reject(Error('MCP deadline'));},40000);const collect=c=>{if(Buffer.byteLength(logs)+c.length>65536){child.kill('SIGTERM');clearTimeout(timer);reject(Error('MCP diagnostic bound'));return;}logs+=c.toString();};child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',c=>{clearTimeout(timer);resolve(c);});});
      const status=mcpStatus(logs);stderr(logs);emit({type:'runtime_phase',phase,mcpStatus:status});
      if(code!==0||status!=='connected'){if(issue==='unknown')issue='mcp_connection';throw Error('MCP unavailable');}
    }
    if(init.config.opencodeTransport==='acp'){
      setPhase('opencode_acp');child=cp.spawn('opencode',['acp'],{env,cwd:'/workspace',stdio:['pipe','pipe','pipe']});child.stderr.on('data',stderr);
      activeAcp=new AcpClient(child,{timeoutMs:init.config.acpTimeoutMs||60000,onSession:id=>{init.nativeSessionId=id;emit({type:'native_session',sessionId:id});},onPermission:requestNativePermission,onUpdate:u=>{const event=acpEvent(u);if(event)emit({type:'stdout',data:Buffer.from(JSON.stringify(event)+'\n').toString('base64')});}});
      try{await activeAcp.open({model:selected.model,sessionId:init.privateRestore?.sessionId||null});setPhase('opencode_task');await activeAcp.prompt(init.task);}finally{const stop=waitAcpExit(child);activeAcp.dispose();activeAcp=null;await stop;}
    }else{
    setPhase('opencode_task');await new Promise((resolve,reject)=>{child=cp.spawn('opencode',['run',init.task,'--format','json','--dir','/workspace',...(init.privateRestore?.sessionId?['--session',init.privateRestore.sessionId]:[])],{env,cwd:'/workspace',stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>emit({type:'stdout',data:c.toString('base64')}));child.stderr.on('data',stderr);child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('CLI failed')));});
    }
  }else{
    const dir=env.HERMES_HOME;fs.mkdirSync(dir,{recursive:true});const key=crypto.randomBytes(24).toString('hex');
    const mcp=init.config.gateway?`agent:\n  disabled_toolsets:\n    - browser\nmcp_servers:\n  orbit:\n    url: "http://127.0.0.1:8081/mcp"\n    headers:\n      Authorization: ${JSON.stringify('Bearer '+init.token)}\n    timeout: 150\n    connect_timeout: 30\n`:'';
    writeRuntimeFile(dir+'/config.yaml',`gateway:\n  multiplex_profiles: false\nmodel:\n  default: ${JSON.stringify(config.workerModel)}\n  provider: custom\n  base_url: ${JSON.stringify(config.workerBaseUrl)}\n  api_key: ${JSON.stringify(init.token)}\nterminal:\n  cwd: /workspace\n  backend: local\napprovals:\n  mode: manual\n  timeout: 120\ncompression:\n  enabled: false\nupdates:\n  check: false\n${mcp}`);
    writeRuntimeFile(dir+'/SOUL.md',init.system||'Work only in /workspace. Ask before actions; report evidence.');
    Object.assign(env,{API_SERVER_ENABLED:'true',API_SERVER_PORT:'8082',API_SERVER_KEY:key});
    setPhase('hermes_startup');child=cp.spawn('hermes',['gateway','run'],{env,cwd:'/workspace',stdio:['ignore','pipe','pipe']});let dead=false,exitCode=null;child.once('exit',code=>{dead=true;exitCode=Number.isInteger(code)?code:null;});child.once('error',()=>dead=true);child.stdout.on('data',stderr);child.stderr.on('data',stderr);
    setPhase('hermes_health');
    let ready=false,healthStatus=null;for(let i=0;i<120&&!dead;i++){try{const r=await fetch('http://127.0.0.1:8082/health',{signal:AbortSignal.timeout(1000)});healthStatus=r.status;await r.body?.cancel();if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}const startup=hermesStartupDetails(dir);if(startup.logIssue!=='unknown')issue=startup.logIssue;emit({type:'runtime_phase',phase,childExited:dead,exitCode,healthStatus,startup});if(!ready)throw Error('Hermes health');
    setPhase('hermes_task');const r=await fetch('http://127.0.0.1:8082/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...(init.nativeSessionId?{'X-Hermes-Session-Id':init.nativeSessionId}:{})},body:JSON.stringify({model:'default',stream:true,messages:[{role:'user',content:init.task}]})});if(!r.ok)throw Error('Hermes API failed');if(init.stateHelper){try{init.nativeSessionId=hermesSessionIdentity(init.nativeSessionId,r.headers.get('x-hermes-session-id'));}catch{issue='native_state_invalid';throw Error('Hermes session acknowledgement changed');}}
    for await(const c of r.body)emit({type:'sse',data:Buffer.from(c).toString('base64')});
    clearInterval(checkpointTimer);
    if(!dead)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{issue='runtime_timeout';reject(Error('Hermes shutdown deadline'));},10000);child.once('close',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
  }
  clearInterval(checkpointTimer);setPhase('final_snapshot');output(); // The host stops the whole container before applying this untrusted candidate.
}
async function isolationCheck(){
  const net=require('net'),checks={};
  checks.nonRoot=process.getuid()!==0;const status=fs.readFileSync('/proc/self/status','utf8');checks.noCapabilities=/^CapEff:\s+0+$/m.test(status);checks.noNewPrivileges=/^NoNewPrivs:\s+1$/m.test(status);
  for(const [name,file] of [['readOnlyInput','/input/escape'],['readOnlyRoot','/etc/orbit-escape']]){try{writeRuntimeFile(file,'probe');checks[name]=false;}catch{checks[name]=true;}}
  checks.noDockerSocket=!fs.existsSync('/var/run/docker.sock');checks.onlyLoopback=fs.readdirSync('/sys/class/net').every(n=>n==='lo');
  const blocked=(host,port)=>new Promise(resolve=>{const s=net.createConnection({host,port});const finish=ok=>{s.destroy();resolve(ok);};s.once('connect',()=>finish(false));s.once('error',()=>finish(true));s.setTimeout(1500,()=>finish(true));});
  checks.externalTcpBlocked=await blocked('203.0.113.1',443);
  if(process.argv[3]){try{fs.readFileSync(process.argv[3]);checks.hostCanaryHidden=false;}catch{checks.hostCanaryHidden=true;}}
  if(process.argv[4])checks.hostLoopbackHidden=await blocked('127.0.0.1',Number(process.argv[4]));
  let cliVersion;
  if(process.argv[5]){const engine=process.argv[5];if(!['hermes','opencode'].includes(engine))throw Error('Unsupported CLI check');const v=cp.spawnSync(engine,['--version'],{env:cleanEnv(),cwd:'/workspace',encoding:'utf8',timeout:30000,maxBuffer:65536});cliVersion=String(v.stdout||'').trim().split('\n')[0];checks.cliFound=v.error?.code!=='ENOENT';checks.cliExitedSuccessfully=!v.error&&v.status===0;checks.cliVersionSupported=/\d+\.\d+/.test(cliVersion)&&(engine!=='opencode'||/^(?:OpenCode\s+)?1\./i.test(cliVersion));checks.cliAvailable=checks.cliFound&&checks.cliExitedSuccessfully&&checks.cliVersionSupported;checks.supportedNode=Number(process.versions.node.split('.')[0])>=20;cliVersion=cliVersion.replace(/[^a-zA-Z0-9 ._-]/g,'').slice(0,120);}
  emit({type:'isolation',checks,...(cliVersion?{cliVersion}:{})});process.exit(Object.values(checks).every(Boolean)?0:1);
}
if(require.main===module){if(process.argv[2]==='--isolation-check')isolationCheck().catch(fail);
else{
  let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;if(buffer.length>16*MAX)return fail();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const m=JSON.parse(line);if(m.type==='init')run(m).catch(fail);else if(m.type==='reply')relayReply(m);else if(m.type==='native_permission_reply')nativePermissionReply(m);else if(m.type==='cancel')activeAcp?.cancel();else throw Error('Protocol');}catch{return fail();}}});
  process.stdin.on('end',()=>process.exit(1));emit({type:'ready'});
}}
function hermesSessionIdentity(expected,received){if(typeof received!=='string'||! /^[a-zA-Z0-9_-]{1,256}$/.test(received)||expected&&received!==expected)throw Error('Invalid acknowledged Hermes session');return received;}
// OpenCode1.18.35 ensureTitle forks an unrelated model request; agent.disable
// removes it before generation. Silent compaction/pruning cannot shorten the
// host-protected conversation. Shared by isolated and legacy mediated launches.
function opencodeMediationPolicy(){return {agent:{title:{disable:true}},compaction:{auto:false,prune:false}};}
module.exports={nativePermissionReply,nativeClientHeaders,nativeProviderConfig,writeRuntimeFile,opencodeMediationPolicy,hermesSessionIdentity,classifyRuntimeIssue,relayPolicy,mcpStatus,createRelay,relayReply,hermesStartupDetails};

// Original bounded ACP v1 client. Lives in this standalone Docker helper so no
// host module, filesystem or terminal service can escape the container boundary.
class AcpClient {
  constructor(process, { timeoutMs=60000, onUpdate=()=>{}, onSession=()=>{}, onPermission=null }={}) {
    this.process=process;this.timeoutMs=timeoutMs;this.onUpdate=onUpdate;this.onSession=onSession;this.onPermission=onPermission;this.permissionPeers=new Set();
    this.decoder=new (require('string_decoder').StringDecoder)('utf8');
    this.pending=new Map();this.nextId=0;this.buffer='';this.frames=0;this.bytes=0;this.sessionId=null;this.replaying=false;this.closed=false;this.active=false;
    this.data=c=>{try{this.feed(c);}catch{this.fail(Error('Invalid or oversized ACP stream.'));}};
    process.stdout.on('data',this.data);process.once('error',()=>this.fail(Error('ACP process unavailable.')));
    process.once('close',()=>this.fail(Error('ACP process exited; prior effects may be unknown.')));
    process.stdin.on('error',()=>this.fail(Error('ACP input unavailable.')));
  }
  send(frame) {
    if(this.closed||this.process.stdin.destroyed)throw Error('ACP connection closed.');
    const line=JSON.stringify({jsonrpc:'2.0',...frame})+'\n';
    if(Buffer.byteLength(line)>MAX)throw Error('ACP request bound exceeded.');
    this.process.stdin.write(line);
  }
  request(method,params) {
    if(this.closed)return Promise.reject(Error('ACP connection closed.'));
    if(this.pending.size>=8)return Promise.reject(Error('ACP request capacity reached.'));
    return new Promise((resolve,reject)=>{
      const id=++this.nextId,timer=setTimeout(()=>this.fail(Error('ACP request deadline exceeded; inspect prior effects.')),method==='session/prompt'?this.timeoutMs:Math.min(this.timeoutMs,60000));
      this.pending.set(id,{resolve,reject,timer,method});
      try{this.send({id,method,params});}catch(e){this.fail(e);}
    });
  }
  feed(chunk) {
    this.bytes+=chunk.length;if(this.bytes>16*MAX)throw Error('ACP stream bound');
    this.buffer+=this.decoder.write(Buffer.from(chunk));if(Buffer.byteLength(this.buffer)>2*MAX)throw Error('ACP frame bound');
    let end;while((end=this.buffer.indexOf('\n'))>=0){
      if(++this.frames>8192)throw Error('ACP event bound');
      const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);
      if(!line.trim())continue;
      this.frame(JSON.parse(line));
    }
  }
  frame(m) {
    if(this.closed)return;
    if(!m||m.jsonrpc!=='2.0'||Array.isArray(m))throw Error('Invalid ACP envelope');
    if(typeof m.method==='string') {
      if(Object.hasOwn(m,'id')) {
        if(!Number.isSafeInteger(m.id)&&typeof m.id!=='string'||typeof m.id==='string'&&m.id.length>256)throw Error('ACP peer id bound');
        // ACP permission requests never manufacture human approval. All actual
        // Orbit actions still go through the broker/Guardian and owning MCP.
        if(m.method==='session/request_permission') {
          if(m.params?.sessionId!==this.sessionId)throw Error('Foreign ACP permission');
          if(this.replaying||!this.active){this.send({id:m.id,result:{outcome:{outcome:'cancelled'}}});return;}
          if(!this.onPermission){this.send({id:m.id,result:{outcome:{outcome:'cancelled'}}});this.fail(Error('ACP requested additional permission; action refused.'));return;}
          if(this.permissionPeers.has(m.id)||this.permissionPeers.size>=500||Buffer.byteLength(JSON.stringify(m.params))>32768)throw Error('ACP permission bound or duplicate');
          this.permissionPeers.add(m.id);
          const reviewed=JSON.parse(JSON.stringify(m.params)),allowOnce=(reviewed.options||[]).filter(o=>o.kind==='allow_once').map(o=>({optionId:o.optionId,kind:o.kind}));
          Promise.resolve().then(()=>this.onPermission(reviewed)).then(optionId=>{
            if(this.closed)return;
            const option=allowOnce.find(o=>o.optionId===optionId);
            this.send({id:m.id,result:{outcome:option?{outcome:'selected',optionId:option.optionId}:{outcome:'cancelled'}}});
          }).catch(()=>{if(!this.closed)this.send({id:m.id,result:{outcome:{outcome:'cancelled'}}});});return;
        }
        this.send({id:m.id,error:{code:-32601,message:'Client capability not provided'}});return;
      }
      if(m.method==='session/update') {
        if(!this.sessionId) {
          // Pinned OpenCode announces commands/config during session/new before
          // its ID acknowledgement. These are not task output or authority.
          if(!this.pending.size||!['available_commands_update','config_option_update'].includes(m.params?.update?.sessionUpdate))throw Error('Unbound ACP update');
          return;
        }
        if(m.params?.sessionId!==this.sessionId)throw Error('Foreign ACP session update');
        if(!m.params.update||typeof m.params.update.sessionUpdate!=='string')throw Error('Invalid ACP update');
        if(this.active&&!this.replaying)this.onUpdate(m.params.update);
      }
      return; // Future notifications are inert; no extension grants authority.
    }
    if(!Number.isSafeInteger(m.id)||!this.pending.has(m.id)||Object.hasOwn(m,'result')===Object.hasOwn(m,'error'))throw Error('Unknown/duplicate ACP response');
    const p=this.pending.get(m.id);this.pending.delete(m.id);clearTimeout(p.timer);
    if(p.method==='session/prompt')this.active=false;
    if(m.error){p.reject(Error('ACP request rejected; no automatic session or transport fallback.'));return;}
    if(!m.result||typeof m.result!=='object'||Array.isArray(m.result)){p.reject(Error('Invalid ACP result.'));return;}
    p.resolve(m.result);
  }
  async open({cwd='/workspace',model,sessionId=null}) {
    if(this.sessionId||this.opening)throw Error('ACP session already initialized.');this.opening=true;
    if(cwd!=='/workspace'||typeof model!=='string'||!/^(?:custom|opencode)\/[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model))throw Error('ACP session scope invalid.');
    if(sessionId!==null&&!/^[a-zA-Z0-9_-]{1,256}$/.test(sessionId))throw Error('Invalid original ACP session ID.');
    const init=await this.request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'orbit',version:'1'}});
    if(init.protocolVersion!==1)throw Error('Unsupported ACP protocol version.');
    this.capabilities=init.agentCapabilities||{};
    if(sessionId) {
      if(this.capabilities.loadSession!==true)throw Error('ACP original session restore unavailable.');
      this.sessionId=sessionId;this.replaying=true;
      try{await this.request('session/load',{sessionId,cwd,mcpServers:[]});}finally{this.replaying=false;}
    }else {
      const s=await this.request('session/new',{cwd,mcpServers:[]});
      if(!/^[a-zA-Z0-9_-]{1,256}$/.test(s.sessionId||''))throw Error('Invalid ACP session acknowledgement.');
      this.sessionId=s.sessionId;
    }
    // Pinned OpenCode extension selects exactly the one mediated provider/model.
    // No inferred/default/paid model fallback or direct provider credential.
    await this.request('session/set_model',{sessionId:this.sessionId,modelId:model});
    await this.onSession(this.sessionId);return this.sessionId;
  }
  async prompt(task) {
    if(!this.sessionId||this.prompting||this.closed)throw Error('ACP prompt is not ready.');
    if(typeof task!=='string'||!task.trim()||Buffer.byteLength(task)>128*1024)throw Error('ACP task bound exceeded.');
    this.active=true;this.prompting=true;
    try {
      const result=await this.request('session/prompt',{sessionId:this.sessionId,prompt:[{type:'text',text:task}]});
      if(this.closed)throw Error('ACP connection failed before turn settlement.');
      if(result.stopReason!=='end_turn')throw Error('ACP turn did not complete ('+(['cancelled','max_tokens','max_turn_requests','refusal'].includes(result.stopReason)?result.stopReason:'unknown')+').');
      return result; // end_turn is a candidate, NOT verified task acceptance.
    }finally{this.active=false;this.prompting=false;}
  }
  cancel() {if(this.sessionId&&!this.closed){try{this.send({method:'session/cancel',params:{sessionId:this.sessionId}});}catch{}}this.fail(Error('ACP turn cancelled; inspect prior effects.'));}
  fail(error) {
    if(this.closed)return;this.closed=true;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();
    try{this.process.kill('SIGTERM');}catch{}
  }
  dispose(){this.fail(Error('ACP connection disposed.'));this.process.stdout.removeListener('data',this.data);}
}
function acpEvent(update) {
  if(update.sessionUpdate==='agent_message_chunk') {
    if(update.content?.type!=='text'||typeof update.content.text!=='string')return null;
    return {type:'acp_text',part:{text:update.content.text}};
  }
  if(['tool_call','tool_call_update'].includes(update.sessionUpdate)) {
    if(typeof update.toolCallId!=='string'||update.toolCallId.length>256)throw Error('Invalid ACP tool identity');
    const status={pending:'running',in_progress:'running',completed:'completed',failed:'failed'}[update.status];
    return {type:'tool_use',part:{tool:'native-tool',id:update.toolCallId,state:{status:status||'running'}}}; // Native names/args/results can contain secrets; do not forward them.
  }
  if(update.sessionUpdate==='plan')return {type:'step_start',part:{type:'step-start'}}; // Observational only; never a new durable plan.
  return null;
}

module.exports.AcpClient=AcpClient;module.exports.acpEvent=acpEvent;

function waitAcpExit(p){if(p.exitCode!==null&&p.exitCode!==undefined||p.signalCode)return Promise.resolve();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{p.removeListener('close',done);reject(Error('ACP shutdown deadline exceeded.'));},10000);const done=()=>{clearTimeout(timer);resolve();};p.once('close',done);});}
