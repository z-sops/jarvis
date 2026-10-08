'use strict';
const test = require('node:test');
const assert = require('node:assert');
const gemini = require('../lib/gemini');

const q429 = (quotaId, retry) => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId, quotaValue: '5' }] }, ...(retry ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry }] : [])] } }) });
const cfg = { apiKey: 'k', textModel: 'gemini-3.8-flash', geminiRetryDelays: [], geminiNoFallback: true };
async function withFetch(res, fn) { const real = global.fetch; global.fetch = async () => res; try { return await fn(); } finally { global.fetch = real; } }

test('a 429 says WHICH limit was hit on WHICH model, instead of the raw error', async () => {
  await withFetch(q429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '31s'), () => assert.rejects(gemini.generate(cfg, {}), e => { assert.equal(e.status, 429); assert.equal(e.quotaKind, 'rpm'); assert.equal(e.quotaDaily, false); assert.match(e.message, /^Gemini 429: gemini-3\.8-flash hit its requests per minute limit \(about 31 seconds to wait\)\.$/); return true; }));
  await withFetch(q429('GenerateContentInputTokensPerModelPerMinute-FreeTier'), () => assert.rejects(gemini.generate(cfg, {}), e => { assert.equal(e.quotaKind, 'tpm'); assert.match(e.message, /hit its input tokens per minute limit\.$/, 'no wait time given: none invented'); return true; }));
  await withFetch(q429('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), () => assert.rejects(gemini.generate(cfg, {}), e => { assert.equal(e.quotaKind, 'rpd'); assert.equal(e.quotaDaily, true); assert.match(e.message, /daily quota for gemini-3\.8-flash is used up/); return true; }));
  await withFetch({ ok: false, status: 429, text: async () => JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota' } }) }, () => assert.rejects(gemini.generate(cfg, {}), e => { assert.equal(e.quotaKind, undefined); assert.match(e.message, /^Gemini 429: /); assert.match(e.message, /exceeded your current quota/, 'without details the original words stay'); return true; }));
});
