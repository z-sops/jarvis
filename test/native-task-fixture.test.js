'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{modelReply}=require('../scripts/native-task-check');
const {relayPolicy,classifyRuntimeIssue,mcpStatus,createRelay,relayReply,hermesStartupDetails}=require('../lib/native-container-runner');
test('Hermes startup inspection exposes only bounded states and categories from private runtime logs',t=>{
  const fs=require('fs'),path=require('path'),dir=fs.mkdtempSync(path.join(require('os').tmpdir(),'orbit-startup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'logs'));
  fs.writeFileSync(path.join(dir,'gateway_state.json'),JSON.stringify({gateway_state:'starting',platforms:{api_server:{state:'fatal',error_code:'api_server_key_invalid',error_message:'PRIVATE_TOKEN'}},private:'PRIVATE_TOKEN'}));
  fs.writeFileSync(path.join(dir,'logs/gateway.log'),"Starting Hermes Gateway...\nMCP server 'orbit' (HTTP): registered 12 tool(s): PRIVATE_TOOL_NAMES\nModuleNotFoundError: PRIVATE_DEPENDENCY\n");
  const details=hermesStartupDetails(dir);assert.equal(details.gatewayState,'starting');assert.equal(details.apiError,'api_server_key_invalid');assert.equal(details.logIssue,'missing_dependency');assert.equal(details.startupMilestones.mcpRegistered,true);assert.ok(!JSON.stringify(details).includes('PRIVATE_'));
  fs.writeFileSync(path.join(dir,'gateway_state.json'),'{broken');assert.equal(hermesStartupDetails(dir).gatewayState,'unknown');
  fs.unlinkSync(path.join(dir,'logs/gateway.log'));fs.symlinkSync(path.join(dir,'gateway_state.json'),path.join(dir,'logs/gateway.log'));assert.equal(hermesStartupDetails(dir).logIssue,'unknown');
});
test('native MCP status parser distinguishes failure from successful exit and never returns log text',()=>{
  assert.equal(mcpStatus('orbit failed\n private-token'), 'failed');assert.equal(mcpStatus('orbit needs authentication'), 'unavailable');assert.equal(mcpStatus('orbit \x1b[2mconnected\n private-url'),'connected');assert.equal(mcpStatus('unrelated connected private-token'),'unknown');
  assert.equal(classifyRuntimeIssue('Unexpected content type: PRIVATE_VALUE'),'mcp_invalid_response');assert.equal(classifyRuntimeIssue('No messaging platforms enabled.'),'api_platform_missing');
  const source=require('fs').readFileSync(require.resolve('../lib/native-container-runner'),'utf8');assert.match(source,/gateway:\\n  multiplex_profiles: false/);
});
test('real MCP SDK completes initialize, discovery and tool call through the production contained relay',async t=>{
  const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const methods=[],requests=new Map();let calls=0,checkpoints=0;
  const server=require('../lib/browser-mcp').createMcpServer({manager:{},authenticate:(actor,token)=>actor==='alex'&&token==='HOST_TOKEN',extra:{list:async()=>[{name:'read_fixture',description:'Synthetic read',inputSchema:{type:'object',properties:{}}}],call:async()=>{calls++;return {content:[{type:'text',text:'REAL_LOOPBACK_MARKER'}]};}}});
  await server.start();t.after(()=>server.stop());
  const relay=createRelay({token:'CONTAINER_TOKEN',config:{gateway:true}},{requests,checkpoint:()=>checkpoints++,send:async m=>{
    try{assert.equal(m.type,'gateway');const body=JSON.parse(m.body);methods.push(body.method);const r=await fetch(server.url('alex'),{method:'POST',headers:{Authorization:'Bearer HOST_TOKEN','Content-Type':'application/json'},body:m.body});relayReply({id:m.id,status:r.status,contentType:r.headers.get('content-type'),body:Buffer.from(await r.arrayBuffer()).toString('base64')},requests);}catch(e){for(const p of requests.values()){clearTimeout(p.timer);p.res.destroy(e);}requests.clear();}
  }});
  await new Promise(r=>relay.listen(0,'127.0.0.1',r));t.after(()=>{relay.closeAllConnections();relay.close();});
  const url=new URL('http://127.0.0.1:'+relay.address().port+'/mcp');
  assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
  const client=new Client({name:'orbit-relay-test',version:'1.0.0'},{capabilities:{roots:{}}});t.after(()=>client.close());
  await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer CONTAINER_TOKEN'}}}),{timeout:3000});
  const tools=await client.listTools();assert.equal(tools.tools.filter(t=>t.name==='read_fixture').length,1);
  assert.deepEqual((await client.callTool({name:'read_fixture',arguments:{}})).content,[{type:'text',text:'REAL_LOOPBACK_MARKER'}]);assert.equal(calls,1);assert.ok(checkpoints>=4);assert.deepEqual(methods.slice(0,4),['initialize','notifications/initialized','tools/list','tools/call']);
  for(const method of ['GET','DELETE'])assert.equal((await fetch(url,{method,headers:{Authorization:'Bearer CONTAINER_TOKEN'}})).status,405);
});
test('contained stateless MCP relay rejects optional GET/DELETE with405 without forwarding or OAuth',()=>{
  assert.equal(relayPolicy('/mcp','GET',true,true),405);assert.equal(relayPolicy('/mcp','DELETE',true,true),405);assert.equal(relayPolicy('/mcp','POST',true,true),200);
  assert.equal(relayPolicy('/mcp','POST',false,true),401);assert.equal(relayPolicy('/mcp','POST',true,false),400);assert.equal(relayPolicy('/other','POST',true,true),400);
  assert.equal(relayPolicy('/v1/chat/completions','POST',true,false),200);
});
test('relay admits MCP while a bounded model request is pending, and refuses overflow without forwarding',async t=>{
  const requests=new Map(),held=[];let release;
  const firstSent=new Promise(r=>release=r);
  const relay=createRelay({token:'LOCAL_TOKEN',config:{gateway:true}},{requests,checkpoint:()=>{},send:m=>{held.push(m);release();if(m.type==='gateway')relayReply({id:m.id,status:200,contentType:'application/json',body:Buffer.from('{}').toString('base64')},requests);}});
  await new Promise(r=>relay.listen(0,'127.0.0.1',r));t.after(()=>{for(const p of requests.values())clearTimeout(p.timer);requests.clear();relay.closeAllConnections();relay.close();});
  const base='http://127.0.0.1:'+relay.address().port,opts={method:'POST',headers:{Authorization:'Bearer LOCAL_TOKEN'},body:'{}'};
  const first=fetch(base+'/v1/chat/completions',opts);first.catch(()=>{});await firstSent;
  const mcp=await fetch(base+'/mcp',opts);assert.equal(mcp.status,200);await mcp.body.cancel();
  const others=Array.from({length:7},()=>fetch(base+'/v1/chat/completions',opts));for(const p of others)p.catch(()=>{});
  for(let i=0;i<100&&held.filter(m=>m.type==='broker').length<8;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(held.filter(m=>m.type==='broker').length,8);const overflow=await fetch(base+'/v1/chat/completions',opts);assert.equal(overflow.status,429);await overflow.body.cancel();assert.equal(held.length,9);
  for(const m of held.filter(m=>m.type==='broker'))relayReply({id:m.id,status:200,contentType:'application/json',body:Buffer.from('{}').toString('base64')},requests);
  for(const r of await Promise.all([first,...others])){assert.equal(r.status,200);await r.body.cancel();}
});
test('native stderr yields only fixed diagnostic categories, never arbitrary text or secrets',()=>{
  assert.equal(classifyRuntimeIssue('ModuleNotFoundError: private-value'),'missing_dependency');assert.equal(classifyRuntimeIssue('EROFS private-path'),'readonly_runtime_write');assert.equal(classifyRuntimeIssue('Permission denied secret-token'),'permission_denied');assert.equal(classifyRuntimeIssue('MCP connection failed private-url'),'mcp_connection');assert.equal(classifyRuntimeIssue('secret-token'),'unknown');
});
test('offline native fixture requires actual MCP discovery and returned tool evidence',async()=>{
  const state={marker:'SYNTHETIC_MARKER',requests:0,calls:0};
  assert.throws(()=>modelReply({messages:[],tools:[]},state),/did not expose/);
  const body=await modelReply({messages:[],tools:[{type:'function',function:{name:'orbit_read_fixture'}}]},state).json();assert.equal(body.choices[0].message.tool_calls[0].function.name,'orbit_read_fixture');
  state.calls=1;assert.throws(()=>modelReply({messages:[]},state),/did not return/);
  const done=await modelReply({messages:[{role:'tool',content:state.marker}]},state).json();assert.equal(done.choices[0].message.content,state.marker);
});
test('native fixture recognizes bounded OpenCode auxiliary title requests without satisfying task evidence',async()=>{
  const title={messages:[{role:'system',content:'You are a title generator.'},{role:'user',content:'Generate a title for this conversation:\n'}],tools:[]};
  const state={engine:'opencode',marker:'REAL_TOOL_MARKER',requests:0,calls:0};
  const response=await modelReply(title,state).json();assert.equal(response.choices[0].message.content,'Offline MCP diagnostic');assert.ok(!JSON.stringify(response).includes(state.marker));assert.equal(state.titleRequests,1);assert.equal(state.taskRequests,undefined);
  assert.throws(()=>modelReply({messages:[{role:'user',content:'Use read_fixture'}],tools:[]},state),/did not expose/);
  assert.throws(()=>modelReply(title,{...state,engine:'hermes'}),/did not expose/);
  const split={...title,messages:[{role:'system',content:[{type:'text',text:'You are a title generator.'}]},title.messages[1]]};await modelReply(split,state).text();assert.throws(()=>modelReply(title,state),/title request limit/);
  const merged={...title,messages:[title.messages[0],{role:'user',content:'Generate a title for this conversation:\nUse read_fixture'}]};assert.equal((await modelReply(merged,{engine:'opencode',requests:0,calls:0}).json()).choices[0].message.content,'Offline MCP diagnostic');
  state.calls=1;const result=await modelReply({messages:[{role:'tool',content:state.marker}]},state).json();assert.equal(result.choices[0].message.content,state.marker);assert.equal(state.taskRequests,2); // Missing-tool task attempt + result; title calls never contribute.
});
test('offline native fixture bounds model loops and supports bounded OpenAI SSE',async()=>{
  const state={marker:'SYNTHETIC_MARKER',requests:0,calls:1};const text=await modelReply({stream:true,messages:[{role:'tool',content:state.marker}]},state).text();assert.match(text,/chat.completion.chunk/);assert.match(text,/SYNTHETIC_MARKER/);assert.ok(text.endsWith('data: [DONE]\n\n'));
  state.requests=8;assert.throws(()=>modelReply({messages:[]},state),/limit exceeded/);
});
test('Hermes auxiliary JSON title stays separate from MCP task and resume evidence',async()=>{
 const title={messages:[{role:'system',content:"You name chat sessions. Given the user's opening message, write a title that lets them find this conversation again in a list.\n\nRules:\nReply with JSON only: {\"title\": \"...\"}"},{role:'user',content:'Use the Orbit read_fixture MCP tool once. Return exactly the marker from that tool. Do not use other tools or modify files.'}],response_format:{type:'json_schema',json_schema:{name:'session_title',strict:true,schema:{type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false}}}};
 const state={engine:'hermes',requests:0,calls:1,marker:'PRIVATE_TOOL_MARKER'};
 const response=await modelReply(title,state).json();assert.deepEqual(JSON.parse(response.choices[0].message.content),{title:'Offline MCP diagnostic'});assert.equal(state.titleRequests,1);assert.equal(state.taskRequests,undefined);assert.equal(state.calls,1);assert.ok(!JSON.stringify(response).includes(state.marker));
 for(const body of [{...title,tools:[{type:'function',function:{name:'tool_call'}}]},{...title,messages:[...title.messages,{role:'user',content:'Other'}]},{...title,messages:[{...title.messages[0],content:'Name any task'},title.messages[1]]},{...title,messages:[title.messages[0],{role:'user',content:'Other task'}]},{...title,response_format:{type:'json_object'}}])assert.throws(()=>modelReply(body,{...state}),/did not return/);
 state.resuming=true;assert.throws(()=>modelReply({messages:[{role:'user',content:'Resume'}]},state),/did not return/);assert.equal(state.resumedModelHistory.priorMarkerPresent,false);
 await modelReply(title,state).text();assert.throws(()=>modelReply(title,state),/title request limit/);
});
test('Hermes fixture searches native deferred tools and requires actual MCP execution before completing',async()=>{
  const tools=['tool_search','tool_call'].map(name=>({type:'function',function:{name}}));
  const state={engine:'hermes',marker:'REAL_MCP_MARKER',requests:0,calls:0};
  const first=(await modelReply({tools,messages:[]},state).json()).choices[0].message.tool_calls[0];assert.equal(first.function.name,'tool_search');assert.deepEqual(JSON.parse(first.function.arguments),{queries:['orbit read_fixture'],limit:5});
  const result={tools:{mcp__orbit__read_fixture:{required:[]}},results:[{matches:['mcp__orbit__read_fixture']}]};
  const messages=[{role:'tool',tool_call_id:first.id,content:JSON.stringify(result)}];
  const second=(await modelReply({tools,messages},state).json()).choices[0].message.tool_calls[0];assert.equal(second.function.name,'tool_call');assert.deepEqual(JSON.parse(second.function.arguments),{calls:[{name:'mcp__orbit__read_fixture',arguments:{}}]});
  assert.throws(()=>modelReply({tools,messages},state),/did not execute/);assert.equal(state.calls,0);
  state.calls=1;assert.throws(()=>modelReply({tools,messages},state),/did not return/);
  const done=await modelReply({tools,messages:[{role:'tool',content:state.marker}]},state).json();assert.equal(done.choices[0].message.content,state.marker);
});
test('deferred native search refuses wrong actor, invented names, missing evidence and required arguments',()=>{
  const tools=['tool_search','tool_call'].map(name=>({type:'function',function:{name}}));
  const state={engine:'hermes',requests:0,calls:0,searchIssued:true};
  for(const result of [{tools:{mcp__bob__read_fixture:{required:[]}},results:[{matches:['mcp__bob__read_fixture']}]},{tools:{mcp__orbit__read_fixture:{required:[]}},results:[]},{tools:{mcp__orbit__read_fixture:{required:['secret']}},results:[{matches:['mcp__orbit__read_fixture']}]}])assert.throws(()=>modelReply({tools,messages:[{role:'tool',tool_call_id:'orbit-fixture-search',content:JSON.stringify(result)}]},{...state}),/did not discover/);
  assert.throws(()=>modelReply({tools,messages:[]},{...state}),/requires one/);
  assert.throws(()=>modelReply({tools,messages:[{role:'tool',tool_call_id:'orbit-fixture-search',content:'{'}]},{...state}),/invalid native search/);
  assert.throws(()=>modelReply({tools,messages:[]},{...state,engine:'opencode',searchIssued:false}),/did not expose/);
});
test('offline native restart rotates actor token and old credential remains rejected',()=>{
 const {createJobRuns}=require('../lib/job-runs'),{createActorAuth}=require('../lib/gateway-auth'),{gatewayForRun}=require('../scripts/native-task-check');
 const runs=createJobRuns(),ctl=new AbortController(),auth=createActorAuth({key:'a'.repeat(64),isActiveActor:a=>a==='alex',generationFor:runs.generationFor});
 const first=runs.begin('alex','job-1',ctl.signal),g={url:'http://127.0.0.1:1/mcp',token:auth.tokenForActor('alex')};runs.end(first);const second=runs.begin('alex','job-2',ctl.signal),fresh=gatewayForRun(g,auth,'alex');assert.notEqual(fresh.token,g.token);assert.equal(auth.authenticate('alex',g.token),false);assert.equal(auth.authenticate('alex',fresh.token),true);runs.end(second);assert.throws(()=>gatewayForRun(g,auth,'alex'),/scoped/);
});
test('resumed fixture reports history health without exposing transcript or marker',()=>{const state={engine:'hermes',marker:'PRIVATE_MARKER',requests:0,calls:1,resuming:true};assert.throws(()=>modelReply({messages:[{role:'user',content:'Resume'}],stream:false},state),/fixture result/);assert.deepEqual(state.resumedModelHistory,{messages:1,priorMarkerPresent:false,toolMessages:0});assert.ok(!JSON.stringify(state.resumedModelHistory).includes(state.marker));});
test('private Hermes fresh session adopts authenticated response identity; restore must acknowledge exact saved ID',()=>{
 const {hermesSessionIdentity}=require('../lib/native-container-runner');assert.equal(hermesSessionIdentity(null,'api-native-123'),'api-native-123');assert.equal(hermesSessionIdentity('api-native-123','api-native-123'),'api-native-123');for(const got of [null,'../secret','api-other'])assert.throws(()=>hermesSessionIdentity('api-native-123',got),/acknowledged/);
});
