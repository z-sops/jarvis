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
test('bounded pagination reaches later configured models; cycles and incomplete catalogs refuse',async()=>{
 const cfg={apiKey:'PAGINATION_KEY',workerRoutes:[route('gemini','later')]},urls=[];
 const chosen=await router.select(cfg,{fetchImpl:async url=>{urls.push(url);return response(url.includes('pageToken=')?{models:[{name:'models/later',supportedGenerationMethods:['generateContent']}]}:{models:[],nextPageToken:'page two'});}});assert.equal(chosen.model,'later');assert.match(urls[1],/pageToken=page%20two/);
 await assert.rejects(router.select({...cfg,apiKey:'CYCLIC_KEY'},{fetchImpl:async()=>response({models:[{name:'models/later',supportedGenerationMethods:['generateContent']}],nextPageToken:'repeat'})}),/No configured/);
});
test('explicit context/capabilities and workload-weighted cost determine pre-submission route',async()=>{
 const cfg={workerProvider:'openai',workerApiKey:'WEIGHTED_KEY',workerRoutes:[route('openai','input-cheap'),{...route('openai','output-cheap'),contextTokens:8192}],workerModelRates:{'input-cheap':{input:1,output:10},'output-cheap':{input:10,output:1}}},fetchImpl=async()=>response({data:[{id:'input-cheap'},{id:'output-cheap'}]});
 assert.equal((await router.select(cfg,{fetchImpl,inputTokens:100,outputTokens:1})).model,'input-cheap');assert.equal((await router.select(cfg,{fetchImpl,inputTokens:1,outputTokens:100})).model,'output-cheap');assert.equal((await router.select(cfg,{fetchImpl,minContextTokens:5000})).model,'output-cheap');await assert.rejects(router.select(cfg,{fetchImpl,minContextTokens:10000}),/No configured/);
});
test('existing built-in worker routes only to Gemini and disables implicit generation fallback',async t=>{
 const fs=require('fs'),os=require('os'),path=require('path'),{Home}=require('../lib/home'),{EventEmitter}=require('events'),home=new Home(fs.mkdtempSync(path.join(os.tmpdir(),'orbit-builtin-route-'))).ensure();t.after(()=>fs.rmSync(home.root,{recursive:true,force:true}));const agent=home.createAgent({name:'Alex'}),prior=global.fetch;t.after(()=>global.fetch=prior);global.fetch=async()=>response({models:[{name:'models/fixture-routed',supportedGenerationMethods:['generateContent']}]});let observed;
 const cfg={engine:'builtin',apiKey:'BUILTIN_ROUTE_KEY',textModel:'ignored',workerRoutes:[route('gemini','fixture-routed')]},workers=require('../lib/workers').createWorkers({home,bus:new EventEmitter(),getCfg:()=>cfg,tools:{declarationsFor:()=>[]},gemini:{runLoop:async o=>{observed=o;return {text:'Fixture report'};}}}),job=home.createJob('alex','Task');await workers.run(agent,job);assert.equal(observed.model,'fixture-routed');assert.equal(observed.cfg.geminiNoFallback,true);assert.equal(home.findJob(job.id).builtinRoute.selected.model,'fixture-routed');assert.doesNotMatch(JSON.stringify(home.findJob(job.id).builtinRoute),/BUILTIN_ROUTE_KEY/);
});
