'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),router=require('../lib/model-router');
const route=(provider,model)=>({provider,model,capabilities:['text','tools'],contextTokens:4096});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
test('router uses authenticated catalogs, configured capabilities/prices and fallback without generation',async()=>{
 const urls=[],cfg={workerProvider:'gemini',apiKey:'ROUTER_KEY_A',workerRouteCredentials:{openai:'ROUTER_KEY_B'},workerRoutes:[route('openai','cheap'),route('gemini','fixture')],workerModelRates:{cheap:{input:1,output:1},fixture:{input:2,output:2}}};
 const selected=await router.select(cfg,{fetchImpl:async(url,o)=>{urls.push(url);return url.includes('openai')?response({},503):response({models:[{name:'models/fixture',supportedGenerationMethods:['generateContent']}]});}});
 assert.equal(selected.provider,'gemini');assert.equal(selected.model,'fixture');assert.equal(selected.evidence.attempts[0].status,'catalog_unavailable');assert.equal(urls.length,2);assert.ok(urls.every(u=>u.includes('/models')));assert.doesNotMatch(JSON.stringify(selected.evidence),/ROUTER_KEY/);
});
test('router refuses missing capability, allowlist, unsupported count providers and missing prices',async()=>{
 for(const patch of [{workerAllowedModels:['other']},{workerCostBudgetUsd:1},{workerRoutes:[{...route('gemini','fixture'),capabilities:['text']}]}])await assert.rejects(router.select({workerProvider:'gemini',apiKey:'KEY',workerRoutes:[route('gemini','fixture')],...patch},{fetchImpl:()=>{throw Error('must not be called');}}),/No configured/);
 assert.throws(()=>router.validate({workerRoutes:[route('openrouter','fixture')]}),/supported count/);assert.throws(()=>router.validate({workerRoutes:[route('gemini','same'),route('openai','same')]}),/unique model/);
});
test('route pinning and credential-isolated cache prevent silently switching an existing transcript',async()=>{
 const cfg={workerProvider:'openai',workerApiKey:'ROUTER_KEY_C',workerRoutes:[route('openai','a'),route('openai','b')],workerModelRates:{a:{input:1,output:1},b:{input:2,output:2}}};
 const fetchImpl=async()=>response({data:[{id:'a'},{id:'b'}]});const first=await router.select(cfg,{fetchImpl});assert.equal(first.model,'a');
 const pinned=await router.select(cfg,{fetchImpl:()=>{throw Error('cache should be used');},pinned:{provider:'openai',model:'b'}});assert.equal(pinned.model,'b');
 await assert.rejects(router.select({...cfg,workerApiKey:'DIFFERENT_KEY'}, {fetchImpl:async()=>response({data:[]})}),/No configured/);
 await assert.rejects(router.select(cfg,{pinned:{provider:'anthropic',model:'b'}}),/no longer matches/);
});
