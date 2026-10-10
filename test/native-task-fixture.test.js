'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{modelReply}=require('../scripts/native-task-check');
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
