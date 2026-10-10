'use strict';
// Real installed CLI + existing containment/MCP; deterministic LOCAL model fixture.
// No provider network, real credentials, host shell task, or production home.
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const C=require('../lib/native-containment'),{Home}=require('../lib/home'),{createJobRuns}=require('../lib/job-runs');
function modelReply(body,state){
  if(++state.requests>8)throw Error('Offline fixture model request limit exceeded.');
  if(!Array.isArray(body.messages))throw Error('Unsupported offline model request schema.');
  let message,finish;
  if(!state.calls){
    const tools=(body.tools||[]).filter(t=>t.type==='function'&&/read_fixture$/.test(t.function?.name||''));
    state.modelTools={functionCount:(body.tools||[]).filter(t=>t.type==='function').length,fixtureCount:tools.length};
    if(tools.length!==1)throw Error('Selected CLI did not expose one Orbit read_fixture MCP tool.');
    message={role:'assistant',content:null,tool_calls:[{id:'orbit-fixture-call',type:'function',function:{name:tools[0].function.name,arguments:'{}'}}]};finish='tool_calls';
  }else{
    if(state.calls!==1||!JSON.stringify(body.messages).includes(state.marker))throw Error('Selected CLI did not return the real MCP fixture result to its model.');
    message={role:'assistant',content:state.marker};finish='stop';
  }
  const usage={prompt_tokens:10,completion_tokens:5,total_tokens:15}; // Synthetic, not billing evidence.
  if(!body.stream)return new Response(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:'orbit-fixture',choices:[{index:0,message,finish_reason:finish}],usage}),{headers:{'content-type':'application/json'}});
  const delta={role:'assistant',...(message.tool_calls?{tool_calls:message.tool_calls.map((t,index)=>({index,...t}))}:{content:message.content})};
  const chunk=(d,f,u)=>({id:'fixture',object:'chat.completion.chunk',created:1,model:'orbit-fixture',choices:[{index:0,delta:d,finish_reason:f}],...(u?{usage:u}:{})});
  return new Response([chunk(delta,null),chunk({},finish,usage)].map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
async function check(image,engine){
  const preflight=await C.checkRuntime({nativeContainerImage:image},engine);
  if(!preflight.ok)return {engine,ok:false,image,stage:'runtime',error:preflight.error};
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-native-task-')),home=new Home(path.join(root,'home')).ensure();
  const actor='fixture-'+engine;home.createAgent({name:actor});const agent=home.getAgent(actor),job=home.createJob(actor,'Offline MCP task');
  const workspace=home.p('workspace',actor,'.native',job.id);fs.mkdirSync(workspace,{recursive:true});
  const state={marker:'ORBIT_FIXTURE_'+crypto.randomUUID(),requests:0,calls:0,mcp:[],phase:'initialization'};fs.writeFileSync(path.join(workspace,'fixture.txt'),state.marker);
  const controller=new AbortController(),runs=createJobRuns(),run=runs.begin(actor,job.id,controller.signal);
  home.updateJob(actor,job.id,{workspaceDir:workspace,isolation:'native_container',status:'running',runId:run.runId});
  const auth=require('../lib/gateway-auth').createActorAuth({key:crypto.randomBytes(32).toString('hex'),isActiveActor:a=>a===actor,generationFor:a=>runs.generationFor(a)});
  const server=require('../lib/browser-mcp').createMcpServer({manager:{},authenticate:auth.authenticate,bindRequest:a=>runs.bind(a),assertCurrent:runs.assertCurrent,extra:{
    list:async()=>[{name:'read_fixture',description:'Read the synthetic offline diagnostic marker.',inputSchema:{type:'object',properties:{},additionalProperties:false}}],
    call:async(a,name,args)=>{runs.assertCurrent();if(a!==actor||name!=='read_fixture'||Object.keys(args).length)throw Error('Unexpected offline fixture tool request.');if(++state.calls!==1)throw Error('Duplicate offline fixture tool execution.');return {content:[{type:'text',text:fs.readFileSync(path.join(workspace,'fixture.txt'),'utf8')}]};}
  }});
  let container,report;
  try{
    await server.start();const gateway={url:server.url(actor),token:auth.tokenForActor(actor)};
    const broker={override:{workerModel:'orbit-fixture',workerApiKey:crypto.randomBytes(24).toString('hex'),workerBaseUrl:'http://127.0.0.1:1/v1'},assertHealthy(){}};
    container=await C.start({home,job:home.findJob(job.id),agent,engine,cfg:{nativeContainerImage:image,workerTimeoutSeconds:90},broker,gateway,signal:controller.signal,runs,run,
      fetchImpl:async(url,options)=>{
        if(url===gateway.url){const rpc=JSON.parse(options.body),response=await fetch(url,options);if(state.mcp.length<20){const known=['initialize','notifications/initialized','tools/list','tools/call','ping','resources/list','prompts/list'];const methods=(Array.isArray(rpc)?rpc:[rpc]).map(x=>known.includes(x.method)?x.method:'other');let toolCount;try{toolCount=(await response.clone().json()).result?.tools?.length;}catch{}state.mcp.push({methods,status:response.status,...(Number.isSafeInteger(toolCount)?{toolCount}:{})});}return response;} // Existing real loopback MCP server only; no arguments/logs/tokens recorded.
        if(url==='http://127.0.0.1:1/v1/models')return new Response(JSON.stringify({object:'list',data:[{id:'orbit-fixture',object:'model',owned_by:'local-fixture'}]}),{headers:{'content-type':'application/json'}});
        if(url!=='http://127.0.0.1:1/v1/chat/completions'||options.method!=='POST')throw Error('Offline fixture refused an unexpected endpoint.');
        return modelReply(JSON.parse(options.body),state); // Never fetch an external provider.
      }});
    const result=await container.execute('Use the Orbit read_fixture MCP tool once. Return exactly the marker from that tool. Do not use other tools or modify files.',{onProgress:p=>{if(p.phase)state.phase=p.phase;for(const key of ['mcpStatus','childExited','exitCode','healthStatus'])if(key in p)(state.runtimeDetails||={})[key]=p[key];}});
    const saved=home.findJob(job.id);
    const checks={nativeResponse:result.trim()===state.marker,owningActorMcp:state.calls===1,modelReceivedToolResult:state.requests>=2,unchangedInput:fs.readFileSync(path.join(workspace,'fixture.txt'),'utf8')===state.marker,checkpointSaved:!!saved.nativeCheckpoint,containerStopped:saved.containment?.status==='stopped'};
    report={engine,ok:Object.values(checks).every(Boolean),image,checks,modelFixtureRequests:state.requests};
  }catch(e){report={engine,ok:false,image,stage:'native_task',error:String(e.message).slice(0,300),modelFixtureRequests:state.requests,mcpCalls:state.calls};}
  finally{
    try{await container?.close();}catch{report={...report,ok:false,error:'Container cleanup is unknown; retain diagnostic home and restore Docker.'};}
    runs.end(run);await server.stop();const status=home.findJob(job.id)?.containment?.status;
    if(!status||status==='stopped')fs.rmSync(root,{recursive:true,force:true});else report={...report,ok:false,retainedDiagnosticHome:root};
  }
  return {...report,diagnostics:{runtimePhase:state.phase,mcp:state.mcp,...(state.runtimeDetails?{runtimeDetails:state.runtimeDetails}:{}),...(state.modelTools?{modelTools:state.modelTools}:{})},scope:'Real contained native CLI, local deterministic model, owning-actor existing MCP and file checkpoint; no live provider, billing or human approval proof.'};
}
async function main(){
  const image=process.argv[2];if(!/^sha256:[a-f0-9]{64}$/.test(image||''))throw Error('Supply an installed immutable image ID.');
  for(const engine of ['hermes','opencode']){const report=await check(image,engine);console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
}
if(require.main===module)main().catch(e=>{console.error(String(e.message).slice(0,300));process.exitCode=1;});
module.exports={modelReply,check};
