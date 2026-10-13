'use strict';
// Text-mode brain (REST). The voice brain uses the Live API from the renderer, with the same tools.
const latency=require('./latency');
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const submissionScope = new (require('async_hooks').AsyncLocalStorage)();
const modelScope = new (require('async_hooks').AsyncLocalStorage)();
const budgetScope = new (require('async_hooks').AsyncLocalStorage)();

// Google answers 503 "high demand" or 429 in busy moments. Those are temporary, so we wait and try again
// instead of letting one hiccup kill a two-minute job. But a DAILY quota cannot be waited out, so it is not retried:
// on the free tier every failed request also counts against the quota, and retrying would only burn it faster.
// Every request that reaches Google (successful or not: failed ones count against the quota too) is reported to an optional hook.
let usageHook = null;
const setUsageHook = fn => { usageHook = typeof fn === 'function' ? fn : null; };
const observe = (fn, event) => { try { if (fn) fn(event); } catch { /* telemetry cannot change an action */ } };
function noteUsage(model, um, failed, agentId) {
  if (!usageHook) return;
  try { usageHook({ source: 'bridge', model, inTok: um ? um.promptTokenCount || 0 : 0, outTok: um ? (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0) : 0, failed: !!failed, agentId }); } catch { /* counting must never break a request */ }
}
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const delaysOf = cfg => (Array.isArray(cfg.geminiRetryDelays) ? cfg.geminiRetryDelays : [2000, 6000]);

// A 429 body says which quota was hit (per minute or per day) and how long to wait.
function quotaInfo(bodyText) {
  try {
    const details = (JSON.parse(bodyText).error || {}).details || [];
    const qf = details.find(d => /QuotaFailure/.test(d['@type'] || '')), ri = details.find(d => /RetryInfo/.test(d['@type'] || ''));
    const v = ((qf && qf.violations) || [])[0] || {}, secs = ri && ri.retryDelay ? parseFloat(ri.retryDelay) : NaN;
    const qid = v.quotaId || ''; return { daily: /PerDay/i.test(qid), kind: /PerDay/i.test(qid) ? 'rpd' : /Token/i.test(qid) ? 'tpm' : /Minute/i.test(qid) ? 'rpm' : null, limit: v.quotaValue, retryMs: Number.isFinite(secs) ? Math.ceil(secs * 1000) : null };
  } catch { return {}; }
}

// The Stop button: shouldStop() is polled while a request runs and while a retry waits, so Stop does not have to wait for Google.
const stopped = () => Object.assign(new Error('Stopped'), { stopped: true });
const sleepStop = (ms, stop) => new Promise((res, rej) => { const t0 = Date.now(), iv = setInterval(() => { if (stop()) { clearInterval(iv); rej(stopped()); } else if (Date.now() - t0 >= ms) { clearInterval(iv); res(); } }, 100); });

async function post(cfg, body, model, onRetry, shouldStop, agentId, onTransport, beforeSubmit) {
  const delays = delaysOf(cfg);let attempts=0;
  for (let i = 0; ; i++) {
    if (shouldStop && shouldStop()) throw stopped();
    let err; const ctl = shouldStop ? new AbortController() : null, poll = ctl && setInterval(() => { if (shouldStop()) ctl.abort(); }, 150);
    try {
      const accounting = budgetScope.getStore();
      let request = body, reservation;
      if (accounting) {
        if ((body.tools || []).some(t => !t.functionDeclarations) || body.cachedContent) throw require('./job-budget').failure('Budgeted requests cannot use unpriced built-in tools or cached billing.');
        if (accounting.policy.usd && !accounting.policy.rates[model]) throw require('./job-budget').failure('This model has no configured token price.');
        request = { ...body, generationConfig: { ...body.generationConfig, maxOutputTokens: accounting.policy.output, candidateCount: 1 } };
      }
      const submitted = JSON.stringify(request);
      const reserve = beforeSubmit || submissionScope.getStore();
      if (reserve) reserve(model);
      if (accounting) {
        const countSignal = ctl ? AbortSignal.any([ctl.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
        let count;
        try {
          count=await latency.timed('token_count',async()=>{const counted=await fetch(`${BASE}/models/${model}:countTokens`, { method: 'POST', signal: countSignal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body: JSON.stringify({ generateContentRequest: { ...request, model: 'models/' + model } }) });if(!counted.ok)throw Error('count failed');return (await counted.json()).totalTokens;});
        } catch { throw require('./job-budget').failure('Provider token count could not be obtained; generation was not submitted.'); }
        if (shouldStop?.()) throw stopped();
        reservation = accounting.reserve(model, count);
      }
      attempts++;
      observe(onTransport, { kind: 'submitted', source: 'gemini_http_body', model, bytes: Buffer.byteLength(submitted) });
      const {res,text}=await latency.timed('model_request',async()=>{const res = await fetch(`${BASE}/models/${model}:generateContent`, {
        method: 'POST', signal: ctl ? ctl.signal : undefined,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        body: submitted
      });
      const text = await res.text();return {res,text};});
      observe(onTransport, { kind: 'received', source: 'gemini_http_body', model, bytes: Buffer.byteLength(text) });
      if (res.ok) { const j = JSON.parse(text); noteUsage(model, j.usageMetadata, false, agentId); if (accounting) accounting.settle(reservation, j.usageMetadata); return j; }
      noteUsage(model, null, true, agentId);
      err = new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`); err.status = res.status;
      if (res.status === 429) {
        const q = quotaInfo(text); err.quotaDaily = !!q.daily; err.retryMs = q.retryMs; err.quotaKind = q.kind || undefined;
        if (!q.daily && q.kind) err.message = `Gemini 429: ${model} hit its ${q.kind === 'tpm' ? 'input tokens per minute' : 'requests per minute'} limit${q.retryMs ? ` (about ${Math.ceil(q.retryMs / 1000)} seconds to wait)` : ''}.`;
        if (q.daily) err.message = `Gemini 429: the daily quota for ${model} is used up${q.limit ? ' (limit ' + q.limit + ' requests a day)' : ''}. It resets at midnight Pacific time, about 12:00 noon in Pakistan. Use a Flash-Lite model or enable billing. ${text.slice(0, 160)}`;
      }
    } catch (e) { err = ctl && ctl.signal.aborted ? stopped() : e; } finally { clearInterval(poll); } // a network error has no status and is worth another try too
    if (err.stopped || err.requestBudget) throw err;
    const retryable = !err.status || RETRYABLE.has(err.status);
    if (err.quotaDaily || !retryable || i >= delays.length) {err.modelAttempts=[{model,status:err.status||null,attempts}];throw err;}
    const wait = err.status === 429 && err.retryMs ? Math.min(err.retryMs, 60000) : delays[i];
    if (onRetry) onRetry({ attempt: i + 1, of: delays.length, waitMs: wait, status: err.status || 'network', model });
    await latency.timed('retry_wait',()=>shouldStop ? sleepStop(wait, shouldStop) : sleep(wait));
  }
}

// When the model stays busy or its daily quota is gone, look for another Gemini flash model on this key (once per run of the app).
// Quotas are per model, so after a daily-quota error the Flash-Lite models (bigger free allowance) come first.
const fallbackCache = new Map();
async function discoverFallback(cfg, primary, preferLite) {
  const key = require('crypto').createHash('sha256').update(JSON.stringify([cfg.apiKey,primary,preferLite,cfg.workerAllowedModels || [],cfg.workerModelRates || {},budgetScope.getStore()?.policy.usd || 0])).digest('hex');
  const cached = fallbackCache.get(key); if (cached && Date.now() - cached.at < 300000) return cached.name;
  let name = null;
  try {
    const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': cfg.apiKey }, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const lite = n => /lite/.test(n);
      const ok = ((await res.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', ''))
        .filter(n => /^gemini-/.test(n) && /flash/.test(n) && !/(live|tts|image|audio|embed|robotics|translate|transcribe|vision)/.test(n) && n !== primary && (preferLite || !lite(n)))
        .filter(n => !cfg.workerAllowedModels?.length || cfg.workerAllowedModels.includes(n))
        .filter(n => !budgetScope.getStore()?.policy.usd || budgetScope.getStore().policy.rates[n]);
      const price = n => { const r = cfg.workerModelRates?.[n]; return r ? r.input + r.output : Infinity; };
      ok.sort((a, b) => price(a) - price(b) || (/preview|exp/.test(a) - /preview|exp/.test(b)) || (preferLite ? lite(b) - lite(a) : 0) || b.localeCompare(a, undefined, { numeric: true }));
      name = ok[0] || null;
    }
  } catch {}
  if (fallbackCache.size >= 32) fallbackCache.delete(fallbackCache.keys().next().value);
  fallbackCache.set(key, { at: Date.now(), name });
  return name;
}

async function generate(cfg, body, model, onRetry, shouldStop, agentId, onTransport, beforeSubmit) {
  if (modelScope.getStore()) cfg = { ...cfg, ...modelScope.getStore() };
  if (!modelScope.getStore()?.worker && !agentId) cfg = { ...cfg, workerAllowedModels: undefined, workerModelRates: undefined };
  if (!cfg.apiKey) throw new Error('No API key set. Open Settings and add your Gemini key.');
  const primary = model || cfg.textModel;
  if (cfg.workerAllowedModels?.length && !cfg.workerAllowedModels.includes(primary)) throw require('./job-budget').failure('Model is outside the configured worker allowlist.');
  try { return await post(cfg, body, primary, onRetry, shouldStop, agentId, onTransport, beforeSubmit); }
  catch (e) {
    if (e.stopped) throw e;
    if (!(e.status && RETRYABLE.has(e.status)) || cfg.geminiNoFallback) throw e;
    const fb = cfg.textFallbackModel || await discoverFallback(cfg, primary, !!e.quotaDaily);
    if (!fb || fb === primary) throw e;
    if (cfg.workerAllowedModels?.length && !cfg.workerAllowedModels.includes(fb)) throw require('./job-budget').failure('Fallback model is outside the configured worker allowlist.');
    if (onRetry) onRetry({ fallback: fb, model: primary });
    try { return await post({ ...cfg, geminiRetryDelays: [2000] }, body, fb, onRetry, shouldStop, agentId, onTransport, beforeSubmit); } catch (e2) { if(e2.stopped||e2.requestBudget)throw e2;e.modelAttempts=[...(e.modelAttempts||[]),...(e2.modelAttempts||[])];throw e; } // report policy failures without hiding them behind the original problem
  }
}

const textOf = content => (content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('').trim();

// Runs the model until it stops asking for tools. `exec(name, args) -> object`
async function runLoopInternal({ cfg, system, contents, tools, exec, maxSteps = 10, onRetry, shouldStop, agentId, model, onStep, onCheckpoint, onTransport, requestBudgetBytes, beforeSubmit, compactReadHistory = false, onContext }) {
  const convo = contents.slice();
  for (let step = 0; step < maxSteps; step++) {
    if (shouldStop && shouldStop()) return { text: 'Cancelled.', convo };
    let body = { systemInstruction: { parts: [{ text: system }] }, contents: convo };
    if (tools?.length) body.tools = [{ functionDeclarations: tools }];
    if (requestBudgetBytes !== undefined) {
      const budget = require('./context-budget');
      if (compactReadHistory) {
        const fitted = budget.fitReadHistory(body, requestBudgetBytes); body = fitted.body;
        if (fitted.omittedReadResults) observe(onContext, { beforeBytes: fitted.beforeBytes, afterBytes: fitted.afterBytes, omittedReadResults: fitted.omittedReadResults, unit: 'utf8_bytes', boundary: 'builtin_read_data_projection' });
      } else budget.check(body, requestBudgetBytes);
    }
    let resp; try { resp = await generate(cfg, body, model, onRetry, shouldStop, agentId, onTransport, beforeSubmit); } catch (e) { if (e.stopped) return { text: 'Stopped.', convo }; throw e; }
    const cand = resp.candidates?.[0];
    if (!cand?.content) {
      const why = resp.promptFeedback?.blockReason || cand?.finishReason || 'empty response';
      return { text: `I couldn't produce an answer (${why}).`, convo };
    }
    convo.push(cand.content); // keep as-is so thought signatures survive
    const calls = (cand.content.parts || []).filter(p => p.functionCall);
    if (!calls.length) return { text: textOf(cand.content), convo };
    observe(onCheckpoint, { step, convo }); // persist pending calls before any tool can have an effect
    const results = [];
    for (const p of calls) { // sequential on purpose: permission prompts must not stack up
      if (shouldStop && shouldStop()) return { text: 'Cancelled.', convo };
      const out = await exec(p.functionCall.name, p.functionCall.args || {});
      const fr = { name: p.functionCall.name, response: { result: out } };
      if (p.functionCall.id) fr.id = p.functionCall.id;
      results.push({ functionResponse: fr });
      if (results.length === 1) convo.push({ role: 'user', parts: results });
      observe(onCheckpoint, { step, convo }); // preserve partial batches if a later tool throws
    }
    if (onStep) { try { onStep({ step, convo }); } catch { /* a checkpoint problem never stops the loop */ } }
  }
  return { text: 'I ran out of steps before finishing. Ask me to continue if you want me to keep going.', convo };
}

async function webSearch(cfg, query) {
  let resp;
  try {
    resp = await generate(cfg, {
      contents: [{ role: 'user', parts: [{ text: `Search the web and answer concisely with the key facts and figures. Query: ${query}` }] }],
      tools: [{ google_search: {} }]
    });
  } catch (e) {
    // Google's free plan gives very little search quota. Do not leave Laila with a raw error: tell her how to carry on.
    if (e && e.status === 429) { const err = new Error('Web search is out of Gemini quota right now (Google limits the free plan, and every failed try counts). Do NOT give up: open a search page in the Orbit Browser instead, for example browser_open https://duckduckgo.com/?q=WORDS+HERE, then browser_read it (and open the best two results), and answer from the pages you read. Open it with background true so the Browser screen does not pop up. Tell the user in one sentence that you used the browser.'); err.status = 429; throw err; }
    throw e;
  }
  const cand = resp.candidates?.[0];
  const sources = (cand?.groundingMetadata?.groundingChunks || []).map(c => c.web).filter(Boolean)
    .slice(0, 5).map(w => ({ title: w.title, uri: w.uri }));
  return { answer: textOf(cand?.content) || 'No results.', sources };
}

async function testKey(apiKey) {
  try {
    const res = await fetch(`${BASE}/models?pageSize=1`, { headers: { 'x-goog-api-key': apiKey } });
    if (res.ok) return { ok: true };
    const t = await res.text();
    return { ok: false, error: `${res.status}: ${t.slice(0, 160)}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

const runLoop = options => budgetScope.run(options.accounting || budgetScope.getStore(), () => submissionScope.run(options.beforeSubmit || submissionScope.getStore(), () => modelScope.run({ apiKey: options.cfg.apiKey, textModel: options.cfg.textModel, worker: !!options.agentId || !!modelScope.getStore()?.worker, workerAllowedModels: options.cfg.workerAllowedModels, workerModelRates: options.cfg.workerModelRates }, () => runLoopInternal(options))));
function describeFailure(e){
 if(e?.status===503){const trail=Array.isArray(e.modelAttempts)?e.modelAttempts.filter(r=>typeof r.model==='string'&&/^[A-Za-z0-9._-]{1,120}$/.test(r.model)&&Number.isSafeInteger(r.attempts)&&r.attempts>0).slice(0,2):[];return 'Gemini is temporarily unavailable (HTTP 503: high demand). This does not establish that your daily quota is exhausted.'+(trail.length?' Attempts: '+trail.map(r=>r.model+' × '+r.attempts+' (HTTP '+(r.status||'unknown')+')').join('; ')+'.':'')+' Your message remains in the conversation; no successful result was received.';}
 return require('./audit').redact(String(e?.message||'Unknown provider failure')).slice(0,1000);
}
module.exports = { describeFailure, generate, runLoop, webSearch, testKey, setUsageHook };
