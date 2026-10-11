'use strict';
// Configured capabilities/prices plus authenticated catalogue evidence, never marketing model claims.
const crypto=require('crypto');
const registry=require('./provider-registry'),SUPPORTED=Object.keys(registry.providers), cache=new Map();
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function validate(cfg) {
  const routes=cfg.workerRoutes || [], credentials=cfg.workerRouteCredentials || {};
  if(!Array.isArray(routes)||routes.length>20||!credentials||typeof credentials!=='object'||Array.isArray(credentials)||Object.entries(credentials).some(([k,v])=>!SUPPORTED.includes(k)||typeof v!=='string'||v.length>4096))throw Error('Invalid bounded worker routing configuration.');
  const seen=new Set();
  for(const r of routes){
    if(!r||Object.keys(r).some(k=>!['provider','model','contextTokens','capabilities'].includes(k))||!SUPPORTED.includes(r.provider)||!/^[A-Za-z0-9._-]{1,120}$/.test(r.model||'')||seen.has(r.model)||!Number.isSafeInteger(r.contextTokens)||r.contextTokens<1024||r.contextTokens>2000000||!Array.isArray(r.capabilities)||!r.capabilities.length||r.capabilities.some(c=>!['text','tools'].includes(c)))throw Error('Routes require unique model IDs, supported count adapters, explicit text/tool capabilities and bounded context limits.');
    seen.add(r.model);
  }
  return routes;
}
function policyHash(cfg){return digest({routes:validate(cfg),allowlist:cfg.workerAllowedModels||[],rates:cfg.workerModelRates||{}});}
async function select(cfg,{fetchImpl=global.fetch,signal,pinned,minContextTokens=0,requiredCapabilities=['text','tools'],inputTokens=1,outputTokens=1,providers=SUPPORTED,countPolicy='exact'}={}) {
  const routes=validate(cfg);if(!routes.length)return null;
  if(!Number.isSafeInteger(minContextTokens)||minContextTokens<0||minContextTokens>2000000||![inputTokens,outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0)||!Array.isArray(requiredCapabilities)||requiredCapabilities.some(c=>!['text','tools'].includes(c))||!Array.isArray(providers)||providers.some(p=>!SUPPORTED.includes(p)))throw Error('Invalid bounded route requirements.');
  if(!['exact','catalog_only'].includes(countPolicy))throw Error('Invalid token count routing policy.');
  const attempts=routes.filter(r=>countPolicy==='exact'&&registry.get(r.provider).count!=='exact').map(r=>({...r,status:'exact_count_unavailable'})),eligible=routes.filter(r=>(countPolicy!=='exact'||registry.get(r.provider).count==='exact')&&providers.includes(r.provider)&&r.contextTokens>=minContextTokens&&requiredCapabilities.every(c=>r.capabilities.includes(c))&&(!cfg.workerAllowedModels?.length||cfg.workerAllowedModels.includes(r.model))&&(!cfg.workerCostBudgetUsd||cfg.workerModelRates?.[r.model]));
  if(pinned&&!eligible.some(r=>r.provider===pinned.provider&&r.model===pinned.model))throw Error('Saved native route no longer matches the explicit routing policy.');
  const price=r=>{const rate=cfg.workerModelRates?.[r.model];return rate?rate.input*inputTokens+rate.output*outputTokens:Infinity;};
  eligible.sort((a,b)=>price(a)-price(b)||a.provider.localeCompare(b.provider)||a.model.localeCompare(b.model));
  for(const r of eligible){
    if(pinned&&(r.provider!==pinned.provider||r.model!==pinned.model))continue;
    signal?.throwIfAborted();
    const primaryProvider=cfg.workerProvider||'gemini';
    const key=cfg.workerRouteCredentials?.[r.provider] || (r.provider===primaryProvider?(cfg.workerApiKey||(r.provider==='gemini'?cfg.apiKey:'')):'');
    if(!key){attempts.push({...r,status:'missing_credential'});continue;}
    const cacheKey=digest({provider:r.provider,key}),hit=cache.get(cacheKey);
    let ids;
    try{
      if(hit&&Date.now()-hit.at<300000)ids=hit.ids;
      else {
        const base=registry.get(r.provider).catalog;
        const headers=registry.headers(r.provider,key);
        ids=new Set();let cursor=null,total=0,bytes=0;const cursors=new Set();
        for(let page=0;page<10;page++){
          const url=base+(cursor?'&'+(r.provider==='gemini'?'pageToken':'after_id')+'='+encodeURIComponent(cursor):'');
          const res=await fetchImpl(url,{headers,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
          if(!res.ok)throw Error('unavailable');
          const chunks=[];for await(const chunk of res.body){if((bytes+=chunk.length)>1024*1024)throw Error('catalog_bound');chunks.push(Buffer.from(chunk));}
          const data=JSON.parse(Buffer.concat(chunks)),entries=r.provider==='gemini'?data.models:data.data;
          if(!Array.isArray(entries)||(total+=entries.length)>2000)throw Error('catalog_shape');
          for(const m of entries)if(r.provider!=='gemini'||m.supportedGenerationMethods?.includes('generateContent')){const id=r.provider==='gemini'?String(m.name).replace(/^models\//,''):m.id;if(typeof id!=='string'||id.length>200)throw Error('catalog_id');ids.add(id);}
          const next=r.provider==='gemini'?data.nextPageToken:r.provider==='anthropic'&&data.has_more?data.last_id:null;
          if(r.provider==='anthropic'&&data.has_more===true&&!next)throw Error('catalog_pagination');
          if(!next)break;
          if(typeof next!=='string'||next.length>4096||cursors.has(next)||page===9)throw Error('catalog_pagination');cursors.add(next);cursor=next;
        }
        if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(cacheKey,{ids,at:Date.now()});
      }
      if(!ids.has(r.model)){attempts.push({...r,status:'not_listed'});continue;}
      return {provider:r.provider,model:r.model,key,contextTokens:r.contextTokens,evidence:{attempts,selected:{provider:r.provider,model:r.model,capabilities:r.capabilities,contextTokens:r.contextTokens,countQuality:registry.get(r.provider).count},policyHash:policyHash(cfg),source:'authenticated_catalog_configured_capabilities_prices_not_generation_proof',at:new Date().toISOString()}};
    }catch{signal?.throwIfAborted();attempts.push({...r,status:'catalog_unavailable'});}
  }
  throw Error('No configured eligible route is available; no model generation was submitted.');
}
module.exports={select,validate,policyHash};
