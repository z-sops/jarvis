'use strict';
// Human-reviewed abandonment of an undelivered model response, never settlement or automatic replay.
const crypto=require('crypto'), adapter=require('./native-provider'), broker=require('./native-broker');
function createRequestRecovery({home,now=Date.now}) {
 const previews=new Map();
 function current(id) {
  const job=home.findJob(id);
  if(!job||!['failed','interrupted','cancelled','rejected'].includes(job.status)||!job.nativeBridge||!home.secretStorage?.available())throw Error('Choose a stopped native job with accessible protected history.');
  home.assertJobsHealthy?.(job.agent);
  if(job.containment?.status==='cleanup_unknown')throw Error('Container cleanup must be confirmed before reviewing recovery.');
  const journal=home.secretStorage.open(job.nativeBridge);
  if(journal.version!==1||journal.actor!==job.agent)throw Error('Native recovery ownership changed.');
  require('./job-retry').historyOwner(home,job,journal.jobId);
  if(journal.provider!=='opencode'||journal.model!=='space-bunny-free'||journal.executionPolicy?.mode!=='requests'||job.tokenBudget)throw Error('This review supports only unbudgeted request-limited OpenCode gateway history. Exact-budget reservations remain protected.');
  if(!Array.isArray(journal.messages)||broker.historyPending(journal.messages).length)throw Error('Inspect unresolved native tool effects before reviewing the provider request.');
  const unknown=[...(journal.unknownRequests||[]),...(journal.pending?[journal.pending]:[])], retired=journal.abandonedRequests||[];
  if(!unknown.length||unknown.length+retired.length>500||!Number.isSafeInteger(journal.requests)||journal.requests<1||journal.requests>journal.requestLimit)throw Error('No bounded unknown request inventory is available.');
  const ids=new Set();for(const r of [...retired,...unknown]){if(!r||typeof r.id!=='string'||ids.has(r.id)||r.mode!=='requests'||r.model!==journal.model||r.outcome!=='unknown_until_durable_response')throw Error('Provider request inventory is inconsistent.');ids.add(r.id);}
  const u=journal.reportedUsage;if(!u||![u.input,u.output,u.responses].every(n=>Number.isSafeInteger(n)&&n>=0)||u.costUsd!==null||u.responses+unknown.length+retired.length!==journal.requests)throw Error('Request accounting is inconsistent; no counters were reset.');
  if(retired.some(r=>r.review?.origin!=='human_main_window_request_recovery'||!r.review.receiptId))throw Error('Unknown request review provenance is invalid.');
  if(job.nativeCheckpoint?.engineState?.pendingEffects)throw Error('Private checkpoint has unresolved effects. Inspect before a fresh native session.');
  return {job,journal,unknown,binding:adapter.digest(job)};
 }
 function preview(id){const s=current(id);for(const [k,p]of previews)if(now()-p.at>300000)previews.delete(k);if(previews.size>=20)previews.delete(previews.keys().next().value);const token=crypto.randomUUID();previews.set(token,{id,binding:s.binding,at:now(),root:home.root});return {token,jobId:id,provider:s.journal.provider,model:s.journal.model,unknownRequests:s.unknown.length,requestsUsed:s.journal.requests,requestLimit:s.journal.requestLimit,scope:'The old provider outcome and usage remain unknown and counted. Preserve its encrypted request record. Explicit Retry starts a fresh private session using saved broker history and workspace checkpoint; it may make new model requests. No old response, tool batch, credential, permission or queued action is replayed. No job starts now.'};}
 function apply(token){const p=previews.get(token);previews.delete(token);if(!p||p.root!==home.root||now()-p.at>300000)throw Error('Request recovery preview expired or was already used.');const s=current(p.id);if(s.binding!==p.binding)throw Error('Job changed after preview; inspect again.');const receipt={receiptId:crypto.randomUUID(),origin:'human_main_window_request_recovery',at:new Date(now()).toISOString(),historicalOnly:true};const j={...s.journal,jobId:s.job.id,pending:null,unknownRequests:[],reportedUsage:{...s.journal.reportedUsage,incomplete:true},abandonedRequests:[...(s.journal.abandonedRequests||[]),...s.unknown.map(r=>({...r,review:receipt}))]};if(s.job.nativeCheckpoint?.engineState)j.privateStateReset={checkpointSha256:s.job.nativeCheckpoint.sha256,origin:receipt.origin};if(Buffer.byteLength(JSON.stringify(j))>1024*1024)throw Error('Recovery history exceeds its bound; nothing was released.');home.updateJob(s.job.agent,s.job.id,{nativeBridge:home.secretStorage.seal(j),nativeContinuity:{...s.job.nativeContinuity,requestOutcome:'reviewed_unknown',unknownRequestCount:j.abandonedRequests.length,requestRecovery:receipt}},{expectedStatus:s.job.status,expectedRunId:s.job.runId,event:'native_request_recovery_reviewed'});return {reviewed:true,unknownRequestsRetained:j.abandonedRequests.length,started:false};}
 return {preview,apply,cancel:token=>{previews.delete(token);return {cancelled:true};}};
}
module.exports={createRequestRecovery};
