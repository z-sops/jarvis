'use strict';
const test = require('node:test');
const assert = require('node:assert');
const gemini = require('../lib/gemini');

const fail = (status, msg = 'x') => ({ ok: false, status, text: async () => JSON.stringify({ error: { code: status, message: msg } }) });
const answer = { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Karachi: about 20 million' }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'UN', uri: 'https://example.org/un' } }] } }] }) };
const cfg = { apiKey: 'k', textModel: 'gemini-a-flash', geminiRetryDelays: [], geminiNoFallback: true };
async function withFetch(impl, fn) { const real = global.fetch; global.fetch = async () => impl(); try { return await fn(); } finally { global.fetch = real; } }

test('web search works, and when Gemini has no quota left Laila is told what to do instead of being left with a raw error', async () => {
  const ok = await withFetch(() => answer, () => gemini.webSearch(cfg, 'karachi population')); assert.match(ok.answer, /20 million/); assert.equal(ok.sources[0].uri, 'https://example.org/un');
  await withFetch(() => fail(429, 'You exceeded your current quota, please check your plan and billing details.'), async () => {
    await assert.rejects(gemini.webSearch(cfg, 'karachi population'), e => { assert.match(e.message, /out of Gemini quota/); assert.match(e.message, /Do NOT give up/); assert.match(e.message, /browser_open https:\/\/duckduckgo\.com\/\?q=/); assert.match(e.message, /browser_read/); assert.ok(!/"error"|"code"|ai\.dev/.test(e.message), 'no raw JSON is shown to her'); assert.equal(e.status, 429, 'the status is kept for the usage meter'); return true; });
  });
  await withFetch(() => fail(403, 'API key not valid'), async () => { await assert.rejects(gemini.webSearch(cfg, 'x'), /Gemini 403/, 'other errors are not disguised'); });
  await withFetch(() => fail(503, 'busy'), async () => { await assert.rejects(gemini.webSearch(cfg, 'x'), /Gemini 503/); });
});
