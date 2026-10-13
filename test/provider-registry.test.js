'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),registry=require('../lib/provider-registry'),adapter=require('../lib/native-provider'),router=require('../lib/model-router');
test('Kimi/Qwen/DeepSeek fixed text adapters report actual usage without inventing an exact counter',()=>{for(const provider of ['kimi','qwen','deepseek']){const r=adapter.prepare(provider,'fixture',{messages:[{role:'user',content:'Question'}],tool_choice:'none'},20);assert.equal(r.url,registry.get(provider).chat);assert.equal(r.body.max_tokens,20);assert.equal(r.countUrl,null);assert.throws(()=>registry.requireExact(provider),/no verified exact/);const d=adapter.decode(provider,{choices:[{finish_reason:'stop',message:{role:'assistant',content:'Reply'}}],usage:{prompt_tokens:10,completion_tokens:2}});assert.equal(d.usage.promptTokenCount,10);assert.equal(d.message.content,'Reply');assert.throws(()=>adapter.decode(provider,{choices:[{finish_reason:'length',message:{role:'assistant',content:'partial'}}]}),/incomplete/);}});
test('additional catalog discovery is credential scoped; strict routing refuses before any remote generation or count',async()=>{for(const provider of ['kimi','deepseek','qwen']){const cfg={workerProvider:provider,workerApiKey:'FIXTURE_'+provider,workerRoutes:[{provider,model:'fixture',contextTokens:8192,capabilities:['text','tools']}]};let calls=0;await assert.rejects(router.select(cfg,{fetchImpl:()=>{calls++;throw Error('no count adapter');}}),/No configured/);assert.equal(calls,0);const r=await router.select(cfg,{countPolicy:'catalog_only',fetchImpl:async(url,o)=>{calls++;assert.equal(url,registry.get(provider).catalog);assert.equal(o.redirect,'error');return new Response('{"data":[{"id":"fixture"}]}');}});assert.equal(r.provider,provider);assert.equal(r.evidence.selected.countQuality,registry.get(provider).count);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(r.evidence),/FIXTURE_/);}});

// Local deterministic protocol fixtures, never real gateway inference.
test('OpenCode gateway has fixed Console endpoints and explicit unavailable exact count',async()=>{
 const spec=registry.get('opencode');
 assert.equal(spec.catalog,'https://opencode.ai/inference/v1/models');
 assert.equal(spec.chat,'https://opencode.ai/inference/v1/chat/completions');
 assert.equal(spec.count,'unavailable');
 assert.throws(()=>registry.requireExact('opencode'),/OpenCode gateway.*no verified exact/);
 const cfg={workerProvider:'opencode',workerApiKey:'FIXTURE_KEY',workerRoutes:[{provider:'opencode',model:'space-bunny-free',contextTokens:8192,capabilities:['text','tools']}]};
 let calls=0;await assert.rejects(router.select(cfg,{fetchImpl:async()=>{calls++;throw Error('must not fetch');}}),/No configured/);assert.equal(calls,0);
 const r=await router.select(cfg,{countPolicy:'catalog_only',fetchImpl:async(url,o)=>{calls++;assert.equal(url,spec.catalog);assert.equal(o.redirect,'error');return new Response(JSON.stringify({data:[{id:'space-bunny-free'}]}));}});
 assert.equal(r.provider,'opencode');assert.equal(r.evidence.selected.countQuality,'unavailable');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(r.evidence),/FIXTURE_KEY/);
});
test('OpenCode gateway adapter preserves bounded tool calls and actual usage, without inventing prices or counts',()=>{
 const body={messages:[{role:'user',content:'Read fixture'}],tools:[{type:'function',function:{name:'read_file',parameters:{type:'object'}}}]};
 const r=adapter.prepare('opencode','space-bunny-free',body,20);
 assert.equal(r.countUrl,null);assert.equal(r.countQuality,'unavailable');assert.equal(r.body.stream,false);assert.equal(r.body.max_tokens,20);assert.deepEqual(r.body.tools,body.tools);
 assert.equal(adapter.prepare('opencode','gpt-fixture',body,20).body.model,'gpt-fixture');
 const data={choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'read-1',type:'function',function:{name:'read_file',arguments:'{"path":"fixture.txt"}'}}]}}],usage:{prompt_tokens:10,completion_tokens:3}};
 const d=adapter.decode('opencode',data);assert.equal(d.message.tool_calls[0].id,'read-1');assert.equal(d.usage.promptTokenCount,10);assert.equal(d.usage.candidatesTokenCount,3);
 for(const patch of [{choices:[{...data.choices[0],finish_reason:'length'}]},{usage:{}},{choices:[{...data.choices[0],finish_reason:'stop'}]}])assert.throws(()=>adapter.decode('opencode',{...data,...patch}));
 const duplicate=structuredClone(data);duplicate.choices[0].message.tool_calls.push(duplicate.choices[0].message.tool_calls[0]);assert.throws(()=>adapter.decode('opencode',duplicate),/function call/);
 const bad=structuredClone(data);bad.choices[0].message.tool_calls[0].function.arguments='null';assert.throws(()=>adapter.decode('opencode',bad),/arguments/);
 const text=adapter.decode('opencode',{choices:[{finish_reason:'stop',message:{role:'assistant',content:'Reply'}}],usage:{prompt_tokens:2,completion_tokens:1}});assert.equal(text.message.content,'Reply');
});
test('worker model catalogue is read-only, bounded, credential-private and refuses stale settings',async()=>{
 const list=require('../lib/opencode-models').list;let key='PRIVATE_CATALOG_KEY',calls=0;const cfg={workerProvider:'opencode',workerApiKey:key},home={getAgent:()=>({id:'alex'})},getCfg=()=>({...cfg,workerApiKey:key});const r=await list({home,getCfg,actor:'alex',fetchImpl:async(url,o)=>{calls++;assert.equal(url,registry.get('opencode').catalog);assert.equal(o.method,'GET');assert.equal(o.redirect,'error');return new Response(JSON.stringify({data:[{id:'mimo-v2.5-free',secret:'PRIVATE'},{id:'nemotron-3-ultra-free'},{id:'space-bunny-free'},{id:'custom-user-model'},{id:'bad\nmodel'},{id:'space-bunny-free'}]}));}});assert.equal(calls,1);assert.deepEqual(r.models,['custom-user-model','mimo-v2.5-free','nemotron-3-ultra-free','space-bunny-free']);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
 await assert.rejects(list({home,getCfg,actor:'alex',fetchImpl:async()=>{key='CHANGED';return new Response('{"data":[{"id":"fixture"}]}');}}),/changed/);await assert.rejects(list({home,getCfg,actor:'alex',fetchImpl:async()=>new Response('PRIVATE',{status:403})}),/HTTP 403/);await assert.rejects(list({home:{getAgent:()=>null},getCfg,actor:'missing',fetchImpl:async()=>{throw Error('must not fetch');}}),/unavailable/);
});
