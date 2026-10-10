'use strict';
// Runs ONLY inside the isolated image. The protocol exposes no arbitrary host URL or command.
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto'),cp=require('child_process');
const MAX=1024*1024, pending=new Map(); let started=false, seq=0, child, lastSnapshot,phase='initialization',issue='unknown';
const emit=x=>process.stdout.write(JSON.stringify(x)+'\n');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function classifyRuntimeIssue(text){if(/ModuleNotFoundError|ImportError|No module named/.test(text))return 'missing_dependency';if(/Read-only file system|EROFS/.test(text))return 'readonly_runtime_write';if(/PermissionError|Permission denied|EACCES/.test(text))return 'permission_denied';if(/MCP.*(?:failed|error|unavailable)/i.test(text))return 'mcp_connection';return 'unknown';}
function stderr(data){const found=classifyRuntimeIssue(String(data));if(found!=='unknown')issue=found;} // Never return native logs/paths/credentials.
function setPhase(value){phase=value;emit({type:'runtime_phase',phase});}
function fail(){emit({type:'failure',phase,issue});process.exit(1);}
function relayPolicy(url,method,authorized,gateway){if(!authorized)return 401;if(url==='/mcp'&&gateway)return method==='POST'?200:405;return ['/v1/chat/completions','/v1/models'].includes(url)&&['GET','POST'].includes(method)?200:400;}
function cleanEnv(){return {PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/home/orbit',XDG_CONFIG_HOME:'/home/orbit/config',XDG_DATA_HOME:'/home/orbit/data',XDG_CACHE_HOME:'/home/orbit/cache',PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',HERMES_HOME:'/home/orbit/hermes'};}
function output(kind='final'){
  const files=[];let bytes=0;
  const walk=(dir,prefix='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const rel=prefix+e.name,full=path.join(dir,e.name),st=fs.lstatSync(full);
    if(st.isSymbolicLink()||(!st.isFile()&&!st.isDirectory())||(st.isFile()&&st.nlink>1))throw Error('Unsafe output');
    if(e.name==='.git')continue;
    if(st.isDirectory())walk(full,rel+'/');else{if(files.length>=2000||st.size>8*MAX||(bytes+=st.size)>64*MAX)throw Error('Output bound');const b=fs.readFileSync(full);files.push({path:rel,sha256:hash(b),bytes:b.length,data:b});}
  }};walk('/workspace');
  const summary=files.map(({data,...f})=>f).sort((a,b)=>a.path.localeCompare(b.path)),digest=hash(Buffer.from(JSON.stringify(summary)));
  if(kind==='checkpoint'&&digest===lastSnapshot)return;
  emit({type:'manifest',kind,files:summary});
  for(const f of files){const b=f.data;for(let offset=0;offset<b.length;offset+=192*1024)emit({type:'file',path:f.path,offset,data:b.subarray(offset,offset+192*1024).toString('base64')});}
  emit({type:'complete',kind});lastSnapshot=digest;
}
async function run(init){
  if(started||!['hermes','opencode'].includes(init.engine)||!Array.isArray(init.input))throw Error('Invalid initialization');started=true;
  const env=cleanEnv();fs.mkdirSync(env.HOME,{recursive:true});
  for(const f of init.input){if(!/^[^\x00-\x1f]+$/.test(f.path)||f.path.split('/').some(s=>!s||s==='.'||s==='..')||f.path.startsWith('/'))throw Error('Input path');const b=fs.readFileSync('/input/'+f.path);if(hash(b)!==f.sha256)throw Error('Input changed');const dst='/workspace/'+f.path;fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,b);}
  const relay=http.createServer(async(req,res)=>{try{
    const gateway=req.url==='/mcp',status=relayPolicy(req.url,req.method,req.headers.authorization==='Bearer '+init.token,init.config.gateway);if(status!==200){res.writeHead(status,status===405?{Allow:'POST'}:{});return res.end('Unsupported isolated request');}
    let body='',n=0;for await(const c of req){n+=c.length;if(n>MAX)throw Error('Relay bound');body+=c;}
    if(pending.size>=1)throw Error('Parallel relay');output('checkpoint');const id=++seq;const timer=setTimeout(()=>{pending.delete(id);res.destroy();},420000);pending.set(id,{res,timer});emit({type:gateway?'gateway':'broker',id,method:req.method,path:req.url,body});
  }catch{res.writeHead(400);res.end('Unsupported isolated request');}});
  await new Promise(r=>relay.listen(8081,'127.0.0.1',r));
  const config={...init.config,workerProvider:'custom',workerApiKey:init.token,workerBaseUrl:'http://127.0.0.1:8081/v1'};
  setPhase('cli_version');const version=cp.spawnSync(init.engine,['--version'],{env,cwd:'/workspace',encoding:'utf8',timeout:30000,maxBuffer:65536});
  if(version.status!==0||init.engine==='opencode'&&!/^(?:OpenCode\s+)?1\./i.test(version.stdout.trim()))throw Error('Unsupported image CLI');
  emit({type:'version',version:String(version.stdout).split('\n')[0].slice(0,120)});
  const checkpointTimer=setInterval(()=>{try{output('checkpoint');}catch{fail();}},10000);checkpointTimer.unref();
  if(init.engine==='opencode'){
    const model=config.workerModel,permission={'*':'deny',read:'allow',glob:'allow',grep:'allow',edit:'allow',bash:'deny',external_directory:'deny'};
    const instructions=env.HOME+'/orbit-instructions.md';fs.writeFileSync(instructions,init.system||'Work only in /workspace. Report evidence.');
    const cfg={model:'custom/'+model,small_model:'custom/'+model,autoupdate:false,instructions:[instructions],enabled_providers:['custom'],provider:{custom:{npm:'@ai-sdk/openai-compatible',name:'Orbit isolated broker',options:{baseURL:config.workerBaseUrl,apiKey:init.token},models:{[model]:{name:model}}}},permission};
    if(init.config.gateway){cfg.mcp={orbit:{type:'remote',url:'http://127.0.0.1:8081/mcp',headers:{Authorization:'Bearer '+init.token},oauth:false,enabled:true}};permission['orbit_*']='allow';}
    const file=env.HOME+'/opencode.json';fs.writeFileSync(file,JSON.stringify(cfg));env.OPENCODE_CONFIG=file;env.OPENCODE_CONFIG_CONTENT=JSON.stringify(cfg);env.OPENCODE_PERMISSION=JSON.stringify(permission);
    setPhase('opencode_task');await new Promise((resolve,reject)=>{child=cp.spawn('opencode',['run',init.task,'--format','json','--dir','/workspace'],{env,cwd:'/workspace',stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>emit({type:'stdout',data:c.toString('base64')}));child.stderr.on('data',stderr);child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('CLI failed')));});
  }else{
    const dir=env.HERMES_HOME;fs.mkdirSync(dir,{recursive:true});const key=crypto.randomBytes(24).toString('hex');
    const mcp=init.config.gateway?`agent:\n  disabled_toolsets:\n    - browser\nmcp_servers:\n  orbit:\n    url: "http://127.0.0.1:8081/mcp"\n    headers:\n      Authorization: ${JSON.stringify('Bearer '+init.token)}\n    timeout: 150\n    connect_timeout: 30\n`:'';
    fs.writeFileSync(dir+'/config.yaml',`model:\n  default: ${JSON.stringify(config.workerModel)}\n  provider: custom\n  base_url: ${JSON.stringify(config.workerBaseUrl)}\n  api_key: ${JSON.stringify(init.token)}\nterminal:\n  cwd: /workspace\n  backend: local\napprovals:\n  mode: manual\n  timeout: 120\ncompression:\n  enabled: false\nupdates:\n  check: false\n${mcp}`);
    fs.writeFileSync(dir+'/SOUL.md',init.system||'Work only in /workspace. Ask before actions; report evidence.');
    Object.assign(env,{API_SERVER_ENABLED:'true',API_SERVER_PORT:'8082',API_SERVER_KEY:key});
    setPhase('hermes_startup');child=cp.spawn('hermes',['gateway','run'],{env,cwd:'/workspace',stdio:['ignore','pipe','pipe']});let dead=false;child.once('exit',()=>dead=true);child.once('error',()=>dead=true);child.stdout.on('data',stderr);child.stderr.on('data',stderr);
    setPhase('hermes_health');
    let ready=false;for(let i=0;i<120&&!dead;i++){try{const r=await fetch('http://127.0.0.1:8082/health',{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('Hermes health');
    setPhase('hermes_task');const r=await fetch('http://127.0.0.1:8082/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'default',stream:true,messages:[{role:'user',content:init.task}]})});if(!r.ok)throw Error('Hermes API failed');
    for await(const c of r.body)emit({type:'sse',data:Buffer.from(c).toString('base64')});
    child.kill('SIGTERM');
  }
  clearInterval(checkpointTimer);setPhase('final_snapshot');output(); // The host stops the whole container before applying this untrusted candidate.
}
async function isolationCheck(){
  const net=require('net'),checks={};
  checks.nonRoot=process.getuid()!==0;const status=fs.readFileSync('/proc/self/status','utf8');checks.noCapabilities=/^CapEff:\s+0+$/m.test(status);checks.noNewPrivileges=/^NoNewPrivs:\s+1$/m.test(status);
  for(const [name,file] of [['readOnlyInput','/input/escape'],['readOnlyRoot','/etc/orbit-escape']]){try{fs.writeFileSync(file,'probe');checks[name]=false;}catch{checks[name]=true;}}
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
  let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;if(buffer.length>4*MAX)return fail();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const m=JSON.parse(line);if(m.type==='init')run(m).catch(fail);else if(m.type==='reply'){const p=pending.get(m.id);if(!p)throw Error('Missing request');pending.delete(m.id);clearTimeout(p.timer);p.res.writeHead(m.status,{'Content-Type':m.contentType});p.res.end(Buffer.from(m.body,'base64'));}else throw Error('Protocol');}catch{return fail();}}});
  process.stdin.on('end',()=>process.exit(1));emit({type:'ready'});
}}
module.exports={classifyRuntimeIssue,relayPolicy};
