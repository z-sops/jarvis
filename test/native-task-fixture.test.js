'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{modelReply}=require('../scripts/native-task-check');
const {relayPolicy,classifyRuntimeIssue,mcpStatus,createRelay,relayReply}=require('../lib/native-container-runner');
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
test('offline native fixture bounds model loops and supports bounded OpenAI SSE',async()=>{
  const state={marker:'SYNTHETIC_MARKER',requests:0,calls:1};const text=await modelReply({stream:true,messages:[{role:'tool',content:state.marker}]},state).text();assert.match(text,/chat.completion.chunk/);assert.match(text,/SYNTHETIC_MARKER/);assert.ok(text.endsWith('data: [DONE]\n\n'));
  state.requests=8;assert.throws(()=>modelReply({messages:[]},state),/limit exceeded/);
});
