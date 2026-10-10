'use strict';
// Explicit trusted-window conversion of visible host-mediated history. Not a private CLI database restore.
const crypto = require('crypto'), adapter = require('./native-provider');
const digest = adapter.digest;
function convertible(journal, provider, model) {
  if (!['gemini','openai','anthropic'].includes(provider) || !/^[A-Za-z0-9._-]{1,120}$/.test(model || '')) throw Error('Choose a supported provider and model ID.');
  if (journal.version !== 1 || !Array.isArray(journal.messages) || !journal.parts || journal.pending || journal.unknownRequests?.length) throw Error('Native history has unknown requests or invalid state. Inspect before conversion.');
  if (require('./native-broker').historyPending(journal.messages).length) throw Error('Resolve pending native tool effects before conversion.');
  adapter.validate({ messages: [...(journal.system || []), ...journal.messages] });
  const seen = new Set(), pending = new Set();
  for (const m of journal.messages) {
    for (const c of m.tool_calls || []) { if(seen.has(c.id))throw Error('Duplicate native tool IDs cannot be converted.');seen.add(c.id);pending.add(c.id); }
    if(m.role==='tool'&&!pending.delete(m.tool_call_id))throw Error('Native tool result has no unique outstanding call.');
  }
  // Opaque reasoning cannot be translated to another provider; retaining an archive is not sufficient.
  for (const raw of Object.values(journal.parts)) {
    if (!Array.isArray(raw)) throw Error('Unsupported native raw history.');
    for (const part of raw) {
      if (journal.provider === 'gemini') {
        if (!part || Object.keys(part).some(k=>!['text','functionCall'].includes(k))) throw Error('Opaque native reasoning/signatures cannot be converted.');
      } else if (journal.provider === 'openai') {
        if (!['message','function_call'].includes(part?.type) || part.content?.some(c=>c.type !== 'output_text' || c.annotations?.length)) throw Error('Opaque native reasoning or annotations cannot be converted.');
      } else if (journal.provider === 'anthropic') {
        if (!['text','tool_use'].includes(part?.type)) throw Error('Opaque native reasoning/signatures cannot be converted.');
      } else throw Error('Unsupported source provider.');
    }
  }
  // Prove the target adapter accepts all visible messages and paired calls without submitting anything.
  adapter.prepare(provider, model, {messages:[...(journal.system || []), ...journal.messages]}, 1, {});
  return { ...journal, provider, model, parts:{}, routing:undefined, convertedFrom: { provider:journal.provider, model:journal.model, historyHash:digest(journal), archive:journal, source:'human_reviewed_visible_history_not_private_session' } };
}
function createConversion({home,now=Date.now}) {
  const previews = new Map();
  function current(id) {
    const job = home.findJob(id);
    if (!job || !['failed','cancelled','interrupted','rejected'].includes(job.status) || !job.nativeBridge || !home.secretStorage?.available()) throw Error('Choose a stopped native job with accessible protected history.');
    home.assertJobsHealthy?.(job.agent);
    const journal = home.secretStorage.open(job.nativeBridge);
    const previous = job.retryOf ? home.findJob(job.retryOf) : null;
    if (journal.actor !== job.agent || journal.jobId !== job.id && (previous?.agent !== job.agent || journal.jobId !== previous?.id)) throw Error('Native history ownership changed.');
    const binding = digest({journal,runId:job.runId,status:job.status,tokenBudget:job.tokenBudget,jobDecisions:job.jobDecisions,permissionReceipts:job.permissionReceipts,nativeCheckpoint:job.nativeCheckpoint});
    return {job,journal,binding};
  }
  function preview(id, target) {
    if (!target || Object.keys(target).some(k=>!['provider','model'].includes(k))) throw Error('Invalid native conversion target.');
    const {job,journal,binding} = current(id);
    if (journal.provider===target.provider && journal.model===target.model) throw Error('The requested provider/model already matches.');
    const converted = convertible(journal,target.provider,target.model);
    if (job.tokenBudget && !job.tokenBudget.policy?.rates?.[target.model] && job.tokenBudget.policy?.usd) throw Error('Target model must already have explicit prices in the original continuation budget policy.');
    if (Buffer.byteLength(JSON.stringify(converted)) > 1024*1024) throw Error('Converted history and protected source archive exceed the bound.');
    for(const [k,v] of previews) if(now()-v.at>300000)previews.delete(k);
    if(previews.size>=20)previews.delete(previews.keys().next().value);
    const token=crypto.randomUUID();previews.set(token,{id,target,binding,at:now(),root:home.root});
    return {token,source:{provider:journal.provider,model:journal.model},target,messages:journal.messages.length,scope:'Visible broker history only. Conversion starts a fresh private native session; the old protected checkpoint stays archived. No permission replay, private database/plugin/TODO conversion or automatic retry.'};
  }
  function apply(token) {
    const p=previews.get(token);previews.delete(token);
    if(!p||p.root!==home.root||now()-p.at>300000)throw Error('Conversion preview expired or already used.');
    const {job,journal,binding}=current(p.id);
    if(binding!==p.binding)throw Error('Native history or recovery evidence changed. Preview again.');
    const converted=convertible(journal,p.target.provider,p.target.model);converted.jobId=job.id;
    if(job.nativeCheckpoint?.engineState)converted.privateStateReset={checkpointSha256:job.nativeCheckpoint.sha256,origin:'human_main_window_conversion'};
    const receipt={id:crypto.randomUUID(),origin:'human_main_window',sourceHash:digest(journal),target:p.target,at:new Date(now()).toISOString(),historicalOnly:true};
    home.updateJob(job.agent,job.id,{nativeBridge:home.secretStorage.seal(converted),nativeContinuity:{...job.nativeContinuity,provider:p.target.provider,model:p.target.model,conversion:receipt}},{expectedStatus:job.status,expectedRunId:job.runId,event:'native_history_converted'});
    return {converted:true,receiptId:receipt.id};
  }
  return {preview,apply,cancel:token=>{previews.delete(token);return {cancelled:true};}};
}
module.exports={convertible,createConversion};
