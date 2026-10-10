'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{modelReply}=require('../scripts/native-task-check');
const {relayPolicy,classifyRuntimeIssue}=require('../lib/native-container-runner');
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
