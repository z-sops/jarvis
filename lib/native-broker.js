'use strict';
// Run-scoped credential broker and encrypted model-history projection, in the existing job record.
const http = require('http'), crypto = require('crypto');
const adapter = require('./native-provider'), { createBudget, policy } = require('./job-budget');
const LIMIT = 1024 * 1024;
const latency=require('./latency');
async function start({ home, job, run, runs, cfg, signal, askNative, decide, fetchImpl = global.fetch, nativeResume = false }) {
  runs.assert(run); signal.throwIfAborted();
  if (!home.secretStorage?.available()) throw Error('Native pre-submission policy requires protected storage for durable conversation history.');
  cfg=require('./team-budget').config(home,job,cfg);
  const gatewayMode = cfg.workerGatewayMode ?? 'exact';
  if (!['exact','requests'].includes(gatewayMode)) throw Error('Invalid OpenCode gateway execution policy.');
  const requestOnly = gatewayMode === 'requests' && ['opencode','openrouter'].includes(cfg.workerProvider);
  const selectionMode=cfg.workerModelSelection??'legacy';
  if(!['auto','pinned','legacy'].includes(selectionMode))throw Error('Invalid native model selection mode.');
  const p = policy(cfg), requestLimit = cfg.workerMaxRequests ?? 40;
  if (!Number.isSafeInteger(requestLimit) || requestLimit < 1 || requestLimit > 500) throw Error('Native request limit must be an integer from 1 to 500.');
  if (requestOnly && (p.enabled || job.tokenBudget)) throw Error('Request-limited gateway execution cannot enforce a token/USD or team budget. Keep exact mode for budgeted jobs; no budget was disabled.');
  if (selectionMode!=='auto' && requestOnly && cfg.workerRoutes?.some(r => r.provider !== cfg.workerProvider || r.model !== cfg.workerModel)) throw Error('Request-limited gateway execution uses the explicitly selected OpenCode model and no automatic alternate routes.');
  const executionPolicy = { mode: requestOnly ? 'requests' : 'exact', requestLimit, outputLimit: p.output };
  const router = require('./model-router'), savedHistory = job.nativeBridge ? home.secretStorage.open(job.nativeBridge) : null;
  if (savedHistory?.routing && savedHistory.routing.policyHash !== router.policyHash(cfg)) throw Error('Native routing policy changed; inspect before a separate job.');
  const routingCfg=selectionMode==='pinned'?{...cfg,workerRoutes:cfg.workerRoutes?.filter(r=>r.provider===(cfg.workerProvider||'gemini')&&r.model===(cfg.workerModel||cfg.textModel))}:cfg;
  if(selectionMode==='auto'&&!cfg.workerRoutes?.length)throw Error('Auto selection requires explicit configured routes and provider credentials.');
  const routeOptions=requestOnly?{countPolicy:'catalog_only',providers:['opencode','openrouter']}:{};
  let selected = await router.select(routingCfg, {fetchImpl,signal,pinned:savedHistory?.routing?.selected,...routeOptions});
  if(selected)selected.evidence.policyHash=router.policyHash(cfg);
  let provider = selected?.provider || cfg.workerProvider || 'gemini', model = selected?.model || cfg.workerModel || cfg.textModel, key = selected?.key || cfg.workerApiKey || (provider === 'gemini' ? cfg.apiKey : '');
  if (!key || !require('./provider-registry').validModel(model)) throw Error('Invalid native provider model/key configuration.');
  if (!requestOnly) require('./provider-registry').requireExact(provider);
  else if (!['opencode','openrouter'].includes(provider) || selectionMode!=='auto' && provider !== cfg.workerProvider) throw Error('Gateway provider/model changed; no fallback is authorized.');
  if (cfg.workerAllowedModels?.length && !cfg.workerAllowedModels.includes(model)) throw Error('Native model is outside the worker allowlist.');
  if (p.usd && !p.rates[model]) throw Error('Explicit model token prices are required before native execution.');
  let journal = { version: 1, actor: job.agent, jobId: job.id, provider, model, requestLimit, executionPolicy, ...(requestOnly ? {reportedUsage:{input:0,output:0,responses:0,source:'provider_reported_not_precount',costUsd:null}} : {}), messages: [], parts: {}, ...(selected ? {routing:selected.evidence} : {}), requests: 0, pending: null };
  if (job.nativeBridge) {
    journal = home.secretStorage.open(job.nativeBridge);
    if (journal.version !== 1 || journal.actor !== job.agent || !Array.isArray(journal.messages) || !journal.parts) throw Error('Invalid native history binding.');
    require('./job-retry').historyOwner(home,job,journal.jobId);
    if (journal.model !== model || journal.requestLimit !== (cfg.workerMaxRequests ?? 40)) throw Error('Native continuation model/request policy changed; inspect before starting a separate job.');
    if (journal.provider !== provider) throw Error('Native history cannot switch provider without a verified transcript conversion.');
    if (!Number.isSafeInteger(journal.requests) || journal.requests < 0 || journal.requests > requestLimit) throw Error('Native request history is invalid; no further submission is authorized.');
    if ((journal.executionPolicy?.mode || 'exact') !== executionPolicy.mode || requestOnly && adapter.digest(journal.executionPolicy) !== adapter.digest(executionPolicy)) throw Error('Native execution mode/request/output policy changed. Start a separately reviewed job instead of changing a continuation.');
    if (requestOnly && (journal.pending || journal.unknownRequests?.length)) throw Error('Prior gateway submission outcome is unknown. Inspect its effects; request-limited continuation cannot automatically replay it.');
    if (requestOnly && journal.outputLimitExceeded) throw Error('Prior gateway output exceeded its limit. Inspect before starting separately reviewed work.');
    if (requestOnly && journal.abandonedRequests && (!Array.isArray(journal.abandonedRequests) || journal.abandonedRequests.length>500 || new Set(journal.abandonedRequests.map(r=>r?.id)).size!==journal.abandonedRequests.length || journal.abandonedRequests.some(r=>r?.mode!=='requests'||typeof r.model!=='string'||!require('./provider-registry').validModel(r.model)||r.outcome!=='unknown_until_durable_response'||r.review?.origin!=='human_main_window_request_recovery'||!r.review.receiptId))) throw Error('Reviewed unknown gateway request inventory is invalid.');
    if (requestOnly && (!journal.reportedUsage || ![journal.requests,journal.reportedUsage.input,journal.reportedUsage.output,journal.reportedUsage.responses].every(n=>Number.isSafeInteger(n)&&n>=0) || journal.reportedUsage.responses + (journal.abandonedRequests?.length || 0) !== journal.requests || journal.reportedUsage.costUsd !== null)) throw Error('Gateway request/usage history is inconsistent; inspect before continuing.');
    if (journal.pending) journal.unknownRequests = [...(journal.unknownRequests || []), journal.pending];
    journal = { ...journal, jobId: job.id, model, pending: null };
  }
  const pendingTools = historyPending(journal.messages);
  if (pendingTools.length) throw Error('Native history contains unresolved tool actions. Inspect their effects and record outcomes through the human recovery control before retrying.');
  const engineModel=model;
  const prefix = structuredClone(journal.messages), token = crypto.randomBytes(32).toString('hex');
  let fault = null, busy = false, restored = false, failureInfo = null;
  const diagnosticEvents=[];
  const note=(stage,code,status)=>{const event={stage,code,...(Number.isInteger(status)&&status>=100&&status<=599?{status}:{})};diagnosticEvents.push(event);if(diagnosticEvents.length>20)diagnosticEvents.shift();return event;};
  const recordFailure=(stage,code,status)=>{if(!failureInfo)failureInfo={source:'host_model_broker',provider,model,...note(stage,code,status)};};
  const diagnostic=()=>failureInfo?{...failureInfo,events:diagnosticEvents.map(e=>({...e}))}:null;
  function assert() { runs.assert(run); signal.throwIfAborted(); if (fault) throw fault; }
  const save = budget => {
    assert(); if (Buffer.byteLength(JSON.stringify(journal)) > LIMIT) throw Error('Native history reached its bound; no state was silently compacted.');
    if(budget)require('./team-budget').check(home,job,budget);
    home.updateJob(job.agent, job.id, { nativeBridge: home.secretStorage.seal(journal), nativeContinuity: { version: 1, requests: journal.requests, restored, pendingTools: historyPending(journal.messages).map(c=>({id:c.id,tool:c.function.name,argumentsSha256:adapter.digest(JSON.parse(c.function.arguments))})), provider, model, ...(requestOnly ? {executionPolicy,reportedUsage:{...journal.reportedUsage},requestOutcome:journal.pending?'unknown':journal.abandonedRequests?.length?'reviewed_unknown':'settled',unknownRequestCount:journal.abandonedRequests?.length||0,budgetGuarantee:'request_count_and_output_only_no_token_usd_ceiling'} : {}), ...(journal.routing ? {routing:journal.routing} : {}), origin: 'host_broker_not_approval' }, ...(budget ? { tokenBudget: budget } : {}) }, { expectedStatus: 'running', expectedRunId: run.runId, event: 'native_model_state' });
  };
  const accounting = createBudget(cfg, save, job.tokenBudget);
  const send = (res, status, body) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); } };
  const upstream = async (url, body) => latency.timed(/count/.test(url)?'token_count':'model_request', async()=>{
    assert(); const stage=/count/.test(url)?'token_count':'model_request';note(stage,'started');let response;try{response = await fetchImpl(url, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), redirect:'error', headers: require('./provider-registry').headers(provider,key), body: JSON.stringify(body) });}catch(e){recordFailure(stage,['TimeoutError','AbortError'].includes(e.name)?'request_interrupted':'network_failure');throw Error('Native provider request transport failed; retained submission may have an unknown outcome.');}
    if (!response.ok) {recordFailure(stage,response.status===401||response.status===403?'authentication_refused':response.status===429?'rate_limited':'provider_http_failure',response.status);}
    if (!response.ok) throw Error('Native upstream request failed (' + response.status + '); inspect retained reservations before retry.');
    const chunks = []; let bytes = 0;
    for await (const c of response.body) { bytes += c.length; if (bytes > LIMIT) { await response.body.cancel?.().catch(()=>{}); throw Error('Native upstream response exceeded the bound.'); } chunks.push(Buffer.from(c)); }
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{recordFailure(stage,'invalid_json');throw Error('Native provider response was not valid JSON; no raw response was retained in diagnostics.');}
  });
  const trace=latency.current();
  const server = http.createServer((req,res)=>latency.within(trace,async()=>{
    let acquired = false;
    try {
      const auth = String(req.headers.authorization || ''), expected = 'Bearer ' + token;
      if (req.headers.origin || req.headers.host !== '127.0.0.1:' + server.address().port || Buffer.byteLength(auth) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(auth),Buffer.from(expected))) return send(res,401,{error:{message:'Unauthorized native run.'}});
      assert();
      if (req.method === 'GET' && req.url === '/v1/models') return send(res,200,{object:'list',data:[{id:engineModel,object:'model',owned_by:'orbit'}]});
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(res,404,{error:{message:'Unsupported native endpoint.'}});
      if (busy) return send(res,409,{error:{message:'Parallel native submissions are refused.'}});
      busy = true; acquired = true;
      const chunks = []; let bytes = 0;
      for await (const c of req) { bytes += c.length; if (bytes > LIMIT) throw Error('Native request exceeded the bound.'); chunks.push(c); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body.model !== engineModel) throw Error('Native model switch is not authorized by this run.');
      adapter.validate(body);
      const system = body.messages.filter(m=>['system','developer'].includes(m.role)), incoming = body.messages.filter(m=>!['system','developer'].includes(m.role));
      const messages = [...system,...mergeHistory(prefix,incoming,nativeResume)]; restored = !!prefix.length;
      const transcript = messages.filter(m=>!['system','developer'].includes(m.role));
      if (journal.messages.length && adapter.digest(canonical(transcript.slice(0,journal.messages.length))) !== adapter.digest(canonical(journal.messages))) throw Error('Native history was shortened or changed; protected state cannot be silently compacted.');
      if (adapter.digest(journal.system || []) !== adapter.digest(system)) journal.systemHistory = [...(journal.systemHistory || []), { at: new Date().toISOString(), messages: system }];
      journal.system = system;
      let request = adapter.prepare(provider,model,{...body,messages},p.output,journal.parts);
      // Always fence the actual submission count before any upstream request.
      if (journal.requests >= requestLimit) throw Error('Native request budget exhausted.');
      let input = null;
      if (!requestOnly) {
        let counted;const excluded=[];
        for(;;){
          try{counted=await upstream(request.countUrl,request.countBody);assert();break;}catch(e){
            // A count-endpoint HTTP refusal is before generation. Never retry an unknown generation.
            if(selectionMode!=='auto'||journal.requests!==0||prefix.length||journal.pending||!selected||failureInfo?.stage!=='token_count'||![401,403,429,500,502,503,504].includes(failureInfo.status))throw e;
            excluded.push(provider+'/'+model);const prior={provider,model,status:failureInfo.status};
            const next=await router.select(routingCfg,{fetchImpl,signal,excluded,...routeOptions});
            if(!next)throw e;next.evidence.policyHash=router.policyHash(cfg);provider=next.provider;model=next.model;key=next.key;selected=next;
            journal.provider=provider;journal.model=model;journal.routing={...next.evidence,switches:[...(journal.routing?.switches||[]),{...prior,toProvider:provider,toModel:model,reason:'count_http_refusal_before_generation',at:new Date().toISOString()}]};
            failureInfo=null;request=adapter.prepare(provider,model,{...body,messages},p.output,{});save();
          }
        }
        input = provider === 'gemini' ? counted.totalTokens : counted.input_tokens;
        if (selected && input + p.output > selected.contextTokens) throw Error('Counted input plus reserved output exceeds the configured route context capacity.');
        if (!Number.isSafeInteger(input) || input < 0) throw Error('Native provider token count is unavailable.');
      }
      journal.messages = messages.filter(m=>!['system','developer'].includes(m.role));
      journal.requests++; journal.pending = { id: crypto.randomUUID(), input, model, ...(requestOnly?{outputLimit:request.body.max_tokens,mode:'requests'}:{}), at: new Date().toISOString(), outcome: 'unknown_until_durable_response' };
      const reservation = accounting ? accounting.reserve(model,input) : (save(),null); // Atomic budget + transcript before generation.
      const data = await upstream(request.url,request.body); assert();
      let decoded;try{decoded=adapter.decode(provider,data);}catch(e){recordFailure('model_response',/usage|metadata|billing/i.test(e.message)?'usage_unavailable':/function|tool|arguments/i.test(e.message)?'invalid_tool_response':/incomplete|did not complete/i.test(e.message)?'incomplete_response':'unsupported_response');throw e;}
      if (requestOnly) {
        const u=journal.reportedUsage,actualInput=decoded.usage.promptTokenCount,actualOutput=decoded.usage.candidatesTokenCount;
        if (![u.input+actualInput,u.output+actualOutput].every(Number.isSafeInteger)) throw Error('Reported gateway usage exceeds its accounting bound.');
        journal.reportedUsage={...u,input:u.input+actualInput,output:u.output+actualOutput,responses:u.responses+1};
        if(actualOutput > request.body.max_tokens) journal.outputLimitExceeded=true;
      }
      journal.messages.push(decoded.message); journal.parts[decoded.key] = decoded.raw; journal.pending = null;
      if (accounting) accounting.settle(reservation,decoded.usage); else save();
      if (requestOnly && decoded.usage.candidatesTokenCount > request.body.max_tokens) throw Error('Gateway exceeded the requested output limit. Actual usage was retained; inspect before continuing.');
      assert();
      // Approve exact native calls before the engine receives them. Never restore an old grant.
      let denied = false;
      for (const c of decoded.message.tool_calls || []) {
        const args = JSON.parse(c.function.arguments), command = args.command || args.cmd;
        const hard = command && (!decide || decide('run_shell',{command},job.agent).level==='deny');
        const restricted = job.reviewTarget && !/^(read|glob|grep|list|search)/i.test(c.function.name);
        let receipt;
        const answer = hard || restricted || !askNative ? 'deny' : await latency.timed('approval_wait',()=>askNative({actor:job.agent,actorName:job.agent,tool:'native/'+c.function.name,title:'Approve this native tool action',detail:require('./audit').redact(JSON.stringify(args)).slice(0,8000),allowSession:false,signal,onDecision:r=>{receipt=r;}}));
        assert();
        const current = home.findJob(job.id);
        const decision = {origin:receipt?.origin || (hard||restricted?'host_policy_denial':'human_permission_result'),receiptId:receipt?.id || crypto.randomUUID(),jobId:job.id,runId:run.runId,tool:'native/'+c.function.name,callId:c.id,argumentsSha256:adapter.digest(args),decision:answer==='once' && receipt?.origin==='human_main_window' && receipt?.id?'once':'deny',at:new Date().toISOString(),historicalOnly:true};
        if((current.jobDecisions||[]).length>=500)throw Error('Native decision history reached its bound.');
        home.updateJob(job.agent,job.id,{jobDecisions:[...(current.jobDecisions||[]),decision]},{expectedStatus:'running',expectedRunId:run.runId,event:'native_tool_permission'});
        if(decision.decision!=='once')denied=true;
      }
      let delivered=decoded.message;
      if(denied){
        journal.messages.push(...(decoded.message.tool_calls||[]).map(c=>({role:'tool',tool_call_id:c.id,content:'HOST: This batch was not delivered to the native engine. No action from this batch was authorized.'})));
        delivered={role:'assistant',content:'Native tool batch declined. No tools from this batch were delivered.'};journal.messages.push(delivered);save();
      }
      const completion = { id:'chatcmpl-'+crypto.randomUUID(),object:'chat.completion',created:Math.floor(Date.now()/1000),model:engineModel,choices:[{index:0,message:decoded.message,finish_reason:decoded.message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:decoded.usage?.promptTokenCount,completion_tokens:(decoded.usage?.candidatesTokenCount||0)+(decoded.usage?.thoughtsTokenCount||0)} };
      completion.choices[0].message=delivered;completion.choices[0].finish_reason=delivered.tool_calls?'tool_calls':'stop';
      if (!body.stream) send(res,200,completion);
      else { res.writeHead(200,{'Content-Type':'text/event-stream'}); const delta={...delivered};delete delta.role; if(delta.tool_calls)delta.tool_calls=delta.tool_calls.map((c,index)=>({...c,index}));res.write('data: '+JSON.stringify({...completion,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({...completion,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:completion.choices[0].finish_reason}]})+'\n\ndata: [DONE]\n\n');res.end(); }
    } catch (e) { const message = e instanceof SyntaxError ? 'Invalid structured native data; no action was delegated.' : e.message; fault = new Error(message);if(!failureInfo)recordFailure('broker_validation',/usage|metadata/i.test(message)?'usage_unavailable':'validation_or_policy_failure');try{home.updateJob(job.agent,job.id,{nativeFailure:diagnostic()},{expectedStatus:'running',expectedRunId:run.runId,event:'native_broker_failure'});}catch{} send(res,400,{error:{message}}); }
    finally { if (acquired) busy = false; }
  }));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const close = () => { server.closeAllConnections(); server.close(); };
  try { assert(); } catch(e) { close(); throw e; }
  signal.addEventListener('abort',close,{once:true});
  return { get identity(){return {provider,model};}, override: { nativeBroker: true, workerProvider:'custom', workerModel:engineModel, workerApiKey:token, workerBaseUrl:'http://127.0.0.1:'+server.address().port+'/v1' }, assertHealthy: assert, failureDiagnostic:diagnostic, close(){signal.removeEventListener('abort',close);close();} };
}
function historyPending(messages) {
  const calls = new Map();
  for (const m of messages) { for (const c of m.tool_calls || []) calls.set(c.id,c); if(m.role==='tool')calls.delete(m.tool_call_id); }
  return [...calls.values()];
}
function resolveUnknown(home, jobId, outcomes) {
  const job = home.findJob(jobId);
  if (!job || !['failed','cancelled','interrupted','rejected'].includes(job.status) || !job.nativeBridge) throw Error('Choose a stopped native job with saved history.');
  const journal = home.secretStorage.open(job.nativeBridge);
  if (journal.actor !== job.agent) throw Error('Native recovery history binding changed.');
  require('./job-retry').historyOwner(home,job,journal.jobId);
  const pending=historyPending(journal.messages);
  if (!pending.length || !Array.isArray(outcomes) || outcomes.length!==pending.length) throw Error('Every pending native action needs an explicit inspected outcome.');
  if ((job.jobDecisions || []).length + pending.length > 500) throw Error('Native decision history reached its bound.');
  const seen=new Set(); const records=outcomes.map(o=>{
    const c=pending.find(c=>c.id===o.id);if(!c||seen.has(o.id)||!['completed','failed','not_executed'].includes(o.outcome)||typeof o.evidence!=='string'||!o.evidence.trim()||o.evidence.length>4000)throw Error('Invalid human-inspected native outcome.');seen.add(o.id);
    return {origin:'human_recovery_inspection',receiptId:crypto.randomUUID(),jobId:job.id,runId:job.runId||null,tool:c.function.name,callId:c.id,argumentsSha256:adapter.digest(JSON.parse(c.function.arguments)),outcome:o.outcome,evidenceSha256:adapter.digest(o.evidence),at:new Date().toISOString(),historicalOnly:true};
  });
  journal.jobId=job.id;
  journal.messages.push(...records.map(r=>({role:'tool',tool_call_id:r.callId,content:JSON.stringify({human_inspection:r.outcome,evidence:outcomes.find(o=>o.id===r.callId).evidence,not_a_permission_grant:true})})));
  if (Buffer.byteLength(JSON.stringify(journal)) > LIMIT) throw Error('Native history reached its bound; inspection was not saved.');
  home.updateJob(job.agent,job.id,{nativeBridge:home.secretStorage.seal(journal),nativeContinuity:{...job.nativeContinuity,pendingTools:[]},jobDecisions:[...(job.jobDecisions||[]),...records]},{expectedStatus:job.status,event:'native_effects_inspected'});
  return {ok:true,resolved:records.length};
}
function canonical(messages) { return messages.map(m=>({role:m.role,content:m.content??null,...(m.tool_call_id?{tool_call_id:m.tool_call_id}:{}),...(m.tool_calls?.length?{tool_calls:m.tool_calls.map(c=>({id:c.id,type:c.type,function:{name:c.function.name,arguments:require('./job-guidance').stable(JSON.parse(c.function.arguments))}}))}:{} )})); }
function mergeHistory(prefix,incoming,nativeResume=false){
  const same=(a,b)=>adapter.digest(canonical(a))===adapter.digest(canonical(b));
  if(!prefix.length)return incoming;
  if(same(incoming.slice(0,prefix.length),prefix))return incoming;
  if(nativeResume){
    let k=0;while(k<Math.min(prefix.length,incoming.length)&&same([prefix[k]],[incoming[k]]))k++;
    // A checkpoint can precede a durable broker response. Preserve that tail; never rerun it.
    if(k>0&&k<prefix.length&&incoming.length===k+1&&incoming[k].role==='user')return [...prefix,incoming[k]];
    if(k>0)throw Error('Restored native history diverges from protected model history. Inspect before continuing.');
    if(incoming.length!==1||incoming[0].role!=='user')throw Error('Restored native history has no verified protected prefix.');
  }
  return [...prefix,...incoming];
}
module.exports = { start, historyPending, resolveUnknown, mergeHistory };
