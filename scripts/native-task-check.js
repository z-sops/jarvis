'use strict';
// Real installed CLI + existing containment/MCP; deterministic LOCAL model fixture.
// No provider network, real credentials, host shell task, or production home.
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const C=require('../lib/native-containment'),{Home}=require('../lib/home'),{createJobRuns}=require('../lib/job-runs');
function isTitleRequest(body,state){
  const text=c=>typeof c==='string'?c:Array.isArray(c)?c.filter(p=>p.type==='text').map(p=>p.text).join(''):'';
  return state.engine==='opencode'&&!(body.tools||[]).length&&body.messages.some(m=>m.role==='system'&&text(m.content).includes('You are a title generator.'))&&body.messages.some(m=>m.role==='user'&&text(m.content).startsWith('Generate a title for this conversation:\n'));
}
function modelReply(body,state){
  if(++state.requests>8)throw Error('Offline fixture model request limit exceeded.');
  if(!Array.isArray(body.messages))throw Error('Unsupported offline model request schema.');
  let message,finish;
  if(isTitleRequest(body,state)){
    if((state.titleRequests=(state.titleRequests||0)+1)>2)throw Error('Offline title request limit exceeded.');
    message={role:'assistant',content:'Offline MCP diagnostic'};finish='stop';
  }else if(!state.calls){
    state.taskRequests=(state.taskRequests||0)+1;
    const tools=(body.tools||[]).filter(t=>t.type==='function'&&/read_fixture$/.test(t.function?.name||''));
    const functions=(body.tools||[]).filter(t=>t.type==='function');
    const has=n=>functions.filter(t=>t.function?.name===n).length===1;
    state.modelTools={functionCount:functions.length,fixtureCount:tools.length,searchAvailable:has('tool_search'),callAvailable:has('tool_call')};
    let name,args={},id='orbit-fixture-call';
    if(tools.length===1)name=tools[0].function.name;
    else if(tools.length===0&&state.engine==='hermes'&&has('tool_search')&&has('tool_call')){
      if(!state.searchIssued){state.searchIssued=true;name='tool_search';args={queries:['orbit read_fixture'],limit:5};id='orbit-fixture-search';}
      else{
        if(state.bridgeIssued)throw Error('Offline fixture MCP bridge did not execute its owning-actor tool.');
        const replies=body.messages.filter(m=>m.role==='tool'&&m.tool_call_id==='orbit-fixture-search');
        if(replies.length!==1||typeof replies[0].content!=='string'||replies[0].content.length>65536)throw Error('Offline fixture requires one bounded native search result.');
        let catalog;try{catalog=JSON.parse(replies[0].content);}catch{throw Error('Offline fixture received invalid native search result.');}
        const names=Object.keys(catalog.tools||{}).filter(n=>n==='mcp__orbit__read_fixture'&&catalog.results?.some(r=>Array.isArray(r.matches)&&r.matches.includes(n)));
        if(names.length!==1||!Array.isArray(catalog.tools[names[0]].required)||catalog.tools[names[0]].required.length)throw Error('Native search did not discover the scoped zero-argument Orbit fixture tool.');
        state.bridgeIssued=true;name='tool_call';args={calls:[{name:names[0],arguments:{}}]};
      }
    }else throw Error('Selected CLI did not expose one Orbit read_fixture MCP tool.');
    message={role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]};finish='tool_calls';
  }else{
    state.taskRequests=(state.taskRequests||0)+1;
    if(state.calls!==1||!JSON.stringify(body.messages).includes(state.marker))throw Error('Selected CLI did not return the real MCP fixture result to its model.');
    message={role:'assistant',content:state.marker};finish='stop';
  }
  const usage={prompt_tokens:10,completion_tokens:5,total_tokens:15}; // Synthetic, not billing evidence.
  if(!body.stream)return new Response(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:'orbit-fixture',choices:[{index:0,message,finish_reason:finish}],usage}),{headers:{'content-type':'application/json'}});
  const delta={role:'assistant',...(message.tool_calls?{tool_calls:message.tool_calls.map((t,index)=>({index,...t}))}:{content:message.content})};
  const chunk=(d,f,u)=>({id:'fixture',object:'chat.completion.chunk',created:1,model:'orbit-fixture',choices:[{index:0,delta:d,finish_reason:f}],...(u?{usage:u}:{})});
  return new Response([chunk(delta,null),chunk({},finish,usage)].map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
async function check(image,engine,privateContinuity=false){
  const preflight=await C.checkRuntime({nativeContainerImage:image},engine);
  if(!preflight.ok)return {engine,ok:false,image,stage:'runtime',error:preflight.error};
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-native-task-')),home=new Home(path.join(root,'home')).ensure();
  if(privateContinuity){const key=crypto.randomBytes(32);home.secretStorage={available:()=>true,seal(v){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(JSON.stringify(v)),c.final()]);return {iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')};},open(v){const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(v.iv,'base64'));d.setAuthTag(Buffer.from(v.tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(v.data,'base64')),d.final()]));}};}
  const actor='fixture-'+engine;home.createAgent({name:actor});const agent=home.getAgent(actor),job=home.createJob(actor,'Offline MCP task');
  const workspace=home.p('workspace',actor,'.native',job.id);fs.mkdirSync(workspace,{recursive:true});
  const state={engine,marker:'ORBIT_FIXTURE_'+crypto.randomUUID(),requests:0,calls:0,mcp:[],phase:'initialization'};fs.writeFileSync(path.join(workspace,'fixture.txt'),state.marker);
  const controller=new AbortController(),runs=createJobRuns();let run=runs.begin(actor,job.id,controller.signal);
  home.updateJob(actor,job.id,{workspaceDir:workspace,isolation:'native_container',status:'running',runId:run.runId});
  const auth=require('../lib/gateway-auth').createActorAuth({key:crypto.randomBytes(32).toString('hex'),isActiveActor:a=>a===actor,generationFor:a=>runs.generationFor(a)});
  const server=require('../lib/browser-mcp').createMcpServer({manager:{},authenticate:auth.authenticate,bindRequest:a=>runs.bind(a),assertCurrent:runs.assertCurrent,extra:{
    list:async()=>[{name:'read_fixture',description:'Read the synthetic offline diagnostic marker.',inputSchema:{type:'object',properties:{},additionalProperties:false}}],
    call:async(a,name,args)=>{runs.assertCurrent();if(a!==actor||name!=='read_fixture'||Object.keys(args).length)throw Error('Unexpected offline fixture tool request.');if(++state.calls!==1)throw Error('Duplicate offline fixture tool execution.');return {content:[{type:'text',text:fs.readFileSync(path.join(workspace,'fixture.txt'),'utf8')}]};}
  }});
  let container,report,currentJobId=job.id;
  try{
    await server.start();const gateway={url:server.url(actor),token:auth.tokenForActor(actor)};
    const broker={identity:{provider:'fixture',model:'orbit-fixture'},override:{workerModel:'orbit-fixture',workerApiKey:crypto.randomBytes(24).toString('hex'),workerBaseUrl:'http://127.0.0.1:1/v1'},assertHealthy(){}};
    const launch={home,job:home.findJob(job.id),agent,engine,cfg:{nativeContainerImage:image,workerTimeoutSeconds:90,nativeContinuity:privateContinuity},broker,gateway,signal:controller.signal,runs,run,
      fetchImpl:async(url,options)=>{
        if(url===gateway.url){const rpc=JSON.parse(options.body),response=await fetch(url,options);if(state.mcp.length<20){const known=['initialize','notifications/initialized','tools/list','tools/call','ping','resources/list','prompts/list'];const methods=(Array.isArray(rpc)?rpc:[rpc]).map(x=>known.includes(x.method)?x.method:'other');let toolCount;try{toolCount=(await response.clone().json()).result?.tools?.length;}catch{}state.mcp.push({methods,status:response.status,...(Number.isSafeInteger(toolCount)?{toolCount}:{})});}return response;} // Existing real loopback MCP server only; no arguments/logs/tokens recorded.
        if(url==='http://127.0.0.1:1/v1/models')return new Response(JSON.stringify({object:'list',data:[{id:'orbit-fixture',object:'model',owned_by:'local-fixture'}]}),{headers:{'content-type':'application/json'}});
        if(url!=='http://127.0.0.1:1/v1/chat/completions'||options.method!=='POST')throw Error('Offline fixture refused an unexpected endpoint.');
        return modelReply(JSON.parse(options.body),state); // Never fetch an external provider.
      }};
    container=await C.start(launch);
    const result=await container.execute('Use the Orbit read_fixture MCP tool once. Return exactly the marker from that tool. Do not use other tools or modify files.',{onProgress:p=>{if(p.phase)state.phase=p.phase;for(const key of ['mcpStatus','childExited','exitCode','healthStatus','startup'])if(key in p)(state.runtimeDetails||={})[key]=p[key];}});
    const saved=home.findJob(job.id);
    const checks={nativeResponse:result.trim()===state.marker,owningActorMcp:state.calls===1,modelReceivedToolResult:state.taskRequests>=2,unchangedInput:fs.readFileSync(path.join(workspace,'fixture.txt'),'utf8')===state.marker,checkpointSaved:!!saved.nativeCheckpoint,containerStopped:saved.containment?.status==='stopped'};
    if(privateContinuity){
      const context={engine,image,route:broker.identity},first=C.readPrivateState(home,saved,context);checks.privateSessionSaved=!!first?.sessionId;
      await container.close();runs.end(run);home.updateJob(actor,job.id,{status:'interrupted'});
      const retry=home.createJob(actor,'Explicit offline native history retry'),next=home.updateJob(actor,retry.id,{...require('../lib/job-retry').carry(home.findJob(job.id)),retryOf:job.id});
      currentJobId=next.id;
      const restarted=new Home(home.root).ensure();restarted.secretStorage=home.secretStorage;restarted.recoverJobs();C.restoreCheckpoint(restarted,restarted.findJob(next.id),context);
      run=runs.begin(actor,next.id,controller.signal);restarted.updateJob(actor,next.id,{status:'running',runId:run.runId});
      container=await C.start({...launch,home:restarted,job:restarted.findJob(next.id),run});
      const resumed=await container.execute('Return the marker from your previous tool result. Do not call any tools or change files.');
      const resumedJob=restarted.findJob(next.id),second=C.readPrivateState(restarted,resumedJob,context);
      checks.privateSessionRestored=second.sessionId===first.sessionId;checks.nativeHistoryReachedModel=resumed.trim()===state.marker&&state.calls===1;checks.retryContainerStopped=resumedJob.containment?.status==='stopped';
    }
    report={engine,ok:Object.values(checks).every(Boolean),image,checks,modelFixtureRequests:state.requests};
  }catch(e){report={engine,ok:false,image,stage:'native_task',error:String(e.message).slice(0,300),modelFixtureRequests:state.requests,mcpCalls:state.calls};}
  finally{
    try{await container?.close();}catch{report={...report,ok:false,error:'Container cleanup is unknown; retain diagnostic home and restore Docker.'};}
    runs.end(run);await server.stop();const status=home.findJob(currentJobId)?.containment?.status;
    if(!status||status==='stopped')fs.rmSync(root,{recursive:true,force:true});else report={...report,ok:false,retainedDiagnosticHome:root};
  }
  return {...report,diagnostics:{runtimePhase:state.phase,mcp:state.mcp,modelRequests:{task:state.taskRequests||0,title:state.titleRequests||0},...(state.runtimeDetails?{runtimeDetails:state.runtimeDetails}:{}),...(state.modelTools?{modelTools:state.modelTools}:{})},scope:privateContinuity?'Real contained native CLI and explicit private-session restart with ephemeral fixture encryption/local deterministic model; no physical power-cut, OS-keystore, live provider, billing or arbitrary plugin proof.':'Real contained native CLI, local deterministic model, owning-actor existing MCP and file checkpoint; no live provider, billing or human approval proof.'};
}
async function main(){
  const image=process.argv[2];if(!/^sha256:[a-f0-9]{64}$/.test(image||''))throw Error('Supply an installed immutable image ID.');
  for(const engine of ['hermes','opencode']){const report=await check(image,engine,process.argv[3]==='--private-continuity');console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
}
if(require.main===module)main().catch(e=>{console.error(String(e.message).slice(0,300));process.exitCode=1;});
module.exports={modelReply,check};
