'use strict';
const test = require('node:test');
const assert = require('node:assert');
const gemini = require('../lib/gemini');

const ok = text => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] }) });
const fail = (status, msg = 'busy') => ({ ok: false, status, text: async () => JSON.stringify({ error: { code: status, message: msg } }) });
const cfg = (extra = {}) => ({ apiKey: 'k', textModel: 'gemini-a-flash', geminiRetryDelays: [1, 1, 1], ...extra });
async function withFetch(impl, fn) { const real = global.fetch; const calls = []; global.fetch = async (url, opts) => { calls.push(String(url)); return impl(String(url), opts, calls.length); }; try { return await fn(calls); } finally { global.fetch = real; } }
const ask = c => gemini.generate(c, { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }, undefined, c.onRetryFn);

test('a temporary 503 is retried and the job carries on', async () => {
  const seen = [];
  const r = await withFetch((u, o, n) => (n < 3 ? fail(503, 'This model is currently experiencing high demand') : ok('done')), async calls => {
    const out = await gemini.generate(cfg(), { contents: [] }, undefined, e => seen.push(e)); assert.equal(calls.length, 3); return out;
  });
  assert.equal(r.candidates[0].content.parts[0].text, 'done'); assert.equal(seen.length, 2); assert.equal(seen[0].status, 503); assert.equal(seen[0].attempt, 1); assert.equal(seen[0].of, 3);
});

test('429 and network errors are retried, but a 400 or 403 is not', async () => {
  await withFetch((u, o, n) => (n === 1 ? fail(429) : n === 2 ? (() => { throw new TypeError('fetch failed'); })() : ok('fine')), async calls => { const r = await gemini.generate(cfg(), {}); assert.equal(calls.length, 3); assert.ok(r.candidates); });
  for (const status of [400, 401, 403, 404]) await withFetch(() => fail(status, 'nope'), async calls => { await assert.rejects(gemini.generate(cfg({ geminiNoFallback: true }), {}), new RegExp('Gemini ' + status)); assert.equal(calls.length, 1, 'no retry for ' + status); });
});

test('when the model stays busy it falls back to another flash model and says so', async () => {
  const models = { models: [
    { name: 'models/gemini-a-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-9-flash-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3-flash-live', supportedGenerationMethods: ['bidiGenerateContent'] },
    { name: 'models/gemini-4-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-4-flash-tts', supportedGenerationMethods: ['generateContent'] }] };
  const seen = [];
  const r = await withFetch((u) => (/\/models\?pageSize/.test(u) ? { ok: true, json: async () => models } : /gemini-5-flash:generate/.test(u) ? ok('from the backup model') : fail(503)), async calls => {
    const out = await gemini.generate(cfg(), {}, undefined, e => seen.push(e));
    assert.ok(calls.some(u => /gemini-5-flash:generate/.test(u)), 'the newest stable flash model is chosen (not preview, live, lite or tts): ' + calls.join(' | ')); return out;
  });
  assert.equal(r.candidates[0].content.parts[0].text, 'from the backup model'); assert.ok(seen.some(e => e.fallback === 'gemini-5-flash'));
});

test('a configured fallback model wins, and if it is busy too the ORIGINAL error is reported', async () => {
  await withFetch((u) => (/backup-model/.test(u) ? ok('ok') : fail(503)), async () => { const r = await gemini.generate(cfg({ textFallbackModel: 'backup-model' }), {}); assert.equal(r.candidates[0].content.parts[0].text, 'ok'); });
  await withFetch(() => fail(503, 'still busy'), async () => { await assert.rejects(gemini.generate(cfg({ textFallbackModel: 'backup-model' }), {}), /Gemini 503.*still busy/s); });
  await assert.rejects(gemini.generate({ textModel: 'm' }, {}), /No API key/);
});

test('runLoop passes the retry reports through', async () => {
  const seen = [];
  await withFetch((u, o, n) => (n === 1 ? fail(503) : ok('answer')), async () => {
    const out = await gemini.runLoop({ cfg: cfg(), system: 's', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: [], exec: async () => ({}), onRetry: e => seen.push(e) });
    assert.equal(out.text, 'answer');
  });
  assert.equal(seen.length, 1); assert.equal(seen[0].status, 503);
});

const quota429 = (quotaId, extra = {}) => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId, quotaValue: '20' }] },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: extra.retryDelay || '14s' }] } }) });

test('a DAILY quota is not retried (it cannot be waited out): the Flash-Lite model with the bigger allowance is tried straight away', async () => {
  const models = { models: [{ name: 'models/gemini-a-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-9-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-5-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-4-flash-lite', supportedGenerationMethods: ['generateContent'] }] };
  const seen = [];
  const r = await withFetch((u) => (/\/models\?pageSize/.test(u) ? { ok: true, json: async () => models } : /gemini-5-flash-lite:generate/.test(u) ? ok('lite answered') : quota429('GenerateRequestsPerDayPerProjectPerModel-FreeTier')), async calls => {
    const out = await gemini.generate(cfg({ geminiRetryDelays: [1, 1, 1] }), {}, undefined, e => seen.push(e));
    assert.equal(calls.filter(u => /gemini-a-flash:generate/.test(u)).length, 1, 'the exhausted model was asked only once (no retries burning quota): ' + calls.join(' | '));
    assert.ok(calls.some(u => /gemini-5-flash-lite:generate/.test(u)), 'the newest Flash-Lite is chosen first after a daily quota error'); return out;
  });
  assert.equal(r.candidates[0].content.parts[0].text, 'lite answered'); assert.ok(seen.some(e => e.fallback === 'gemini-5-flash-lite'));
});

test('a per-minute 429 waits for the time Google asks for, then carries on', async () => {
  const seen = [];
  const r = await withFetch((u, o, n) => (n === 1 ? quota429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', { retryDelay: '0.002s' }) : ok('after the wait')), async calls => {
    const out = await gemini.generate(cfg(), {}, undefined, e => seen.push(e)); assert.equal(calls.length, 2); return out;
  });
  assert.equal(r.candidates[0].content.parts[0].text, 'after the wait'); assert.equal(seen[0].waitMs, 2, 'uses the delay from RetryInfo, not the default backoff');
});

test('when nothing works the error says plainly that the daily quota is used up, and when it resets', async () => {
  await withFetch(() => quota429('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), async () => {
    await assert.rejects(gemini.generate(cfg({ geminiNoFallback: true }), {}), /daily quota for gemini-a-flash is used up \(limit 20 requests a day\).*12:00 noon in Pakistan/s);
  });
});

test('usage hook: every request is reported, failed ones too, with the tokens Google says it used', async () => {
  const seen = []; gemini.setUsageHook(e => seen.push(e));
  try {
    await withFetch((u, o, n) => (n === 1 ? { ok: false, status: 503, text: async () => '{"error":{"code":503}}' } : { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 30, thoughtsTokenCount: 70 } }) }), async () => { await gemini.generate(cfg(), {}); });
  } finally { gemini.setUsageHook(null); }
  assert.equal(seen.length, 2); assert.equal(seen[0].failed, true); assert.equal(seen[0].inTok, 0);
  assert.equal(seen[1].failed, false); assert.equal(seen[1].inTok, 1200); assert.equal(seen[1].outTok, 100, 'thinking tokens count as output'); assert.equal(seen[1].source, 'bridge'); assert.equal(seen[1].model, 'gemini-a-flash');
});

test('Stop: a request in flight and a retry wait both end at once, and the loop answers "Stopped."', async () => {
  let stop = false; const sig = [];
  // a request that never answers until it is aborted
  await withFetch((u, o) => new Promise((res, rej) => { sig.push(o.signal); o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }), async () => {
    const t0 = Date.now(); setTimeout(() => { stop = true; }, 300);
    const r = await gemini.runLoop({ cfg: cfg(), system: 's', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: [], exec: async () => ({}), shouldStop: () => stop });
    assert.equal(r.text, 'Stopped.'); assert.ok(Date.now() - t0 < 1500, 'did not wait for Google: ' + (Date.now() - t0) + ' ms'); assert.equal(sig.length, 1, 'no retry after Stop');
  });
  stop = false; const seen = [];
  // a busy model: the retry wait is 5 s, but Stop ends it at once
  await withFetch(() => ({ ok: false, status: 503, text: async () => '{"error":{"code":503}}' }), async calls => {
    const t0 = Date.now(); setTimeout(() => { stop = true; }, 400);
    await assert.rejects(gemini.generate(cfg({ geminiRetryDelays: [5000, 5000], geminiNoFallback: true }), {}, undefined, e => seen.push(e), () => stop), /Stopped/);
    assert.ok(Date.now() - t0 < 1500, 'the wait was cut short: ' + (Date.now() - t0) + ' ms'); assert.equal(calls.length, 1);
  });
});


test('exhausted Gemini fallback records actual attempts and produces safe high-demand guidance',async()=>{
 await withFetch(()=>fail(503,'PRIVATE_RESPONSE_TEXT'),async()=>{let error;try{await gemini.generate(cfg({textFallbackModel:'backup-fixture'}),{contents:[]});}catch(e){error=e;}assert.ok(error);assert.deepEqual(error.modelAttempts,[{model:'gemini-a-flash',status:503,attempts:4},{model:'backup-fixture',status:503,attempts:2}]);const text=gemini.describeFailure(error);assert.match(text,/daily quota/);assert.match(text,/backup-fixture/);assert.doesNotMatch(text,/PRIVATE_RESPONSE_TEXT|\{"error"/);});
});
