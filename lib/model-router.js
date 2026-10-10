'use strict';
// Configured capabilities/prices plus authenticated catalogue evidence, never marketing model claims.
const crypto=require('crypto');
const SUPPORTED=['gemini','openai','anthropic'], cache=new Map();
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
async function select(cfg,{fetchImpl=global.fetch,signal,pinned}={}) {
  const routes=validate(cfg);if(!routes.length)return null;
  const attempts=[],eligible=routes.filter(r=>r.capabilities.includes('text')&&r.capabilities.includes('tools')&&(!cfg.workerAllowedModels?.length||cfg.workerAllowedModels.includes(r.model))&&(!cfg.workerCostBudgetUsd||cfg.workerModelRates?.[r.model]));
  if(pinned&&!eligible.some(r=>r.provider===pinned.provider&&r.model===pinned.model))throw Error('Saved native route no longer matches the explicit routing policy.');
  const price=r=>{const rate=cfg.workerModelRates?.[r.model];return rate?rate.input+rate.output:Infinity;};
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
        const url=r.provider==='gemini'?'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200':r.provider==='openai'?'https://api.openai.com/v1/models':'https://api.anthropic.com/v1/models?limit=1000';
        const headers=r.provider==='gemini'?{'x-goog-api-key':key}:r.provider==='anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+key};
        const res=await fetchImpl(url,{headers,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
        if(!res.ok)throw Error('unavailable');
        let size=0, chunks=[];for await(const b of res.body){if((size+=b.length)>1024*1024)throw Error('catalog_bound');chunks.push(Buffer.from(b));}
        const data=JSON.parse(Buffer.concat(chunks));
        const entries=r.provider==='gemini'?data.models:data.data;if(!Array.isArray(entries)||entries.length>2000)throw Error('catalog_shape');
        ids=new Set(entries.filter(m=>r.provider!=='gemini'||m.supportedGenerationMethods?.includes('generateContent')).map(m=>r.provider==='gemini'?String(m.name).replace(/^models\//,''):m.id));
        if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(cacheKey,{ids,at:Date.now()});
      }
      if(!ids.has(r.model)){attempts.push({...r,status:'not_listed'});continue;}
      return {provider:r.provider,model:r.model,key,contextTokens:r.contextTokens,evidence:{attempts,selected:{provider:r.provider,model:r.model,capabilities:r.capabilities,contextTokens:r.contextTokens},policyHash:policyHash(cfg),source:'authenticated_catalog_configured_capabilities_prices_not_generation_proof',at:new Date().toISOString()}};
    }catch{signal?.throwIfAborted();attempts.push({...r,status:'catalog_unavailable'});}
  }
  throw Error('No configured eligible route is available; no model generation was submitted.');
}
module.exports={select,validate,policyHash};
