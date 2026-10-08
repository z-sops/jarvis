'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('../lib/quota'), { createUsage } = require('../lib/usage');

test('the default limits are the ones AI Studio showed, and the most specific match wins', () => {
  const L = Q.DEFAULT_LIMITS; assert.deepEqual(Q.limitFor('gemini-3.8-flash', L), { match: 'flash', name: 'Flash', rpm: 5, tpm: 250000, rpd: 20 }); assert.equal(Q.limitFor('gemini-3.5-flash-lite', L).rpd, 500, 'flash-lite is not mistaken for flash'); assert.equal(Q.limitFor('gemini-3.8-live', L).rpd, null); assert.equal(Q.limitFor('gemini-2.5-pro', L), null); assert.equal(Q.limitFor(undefined, L), null);
});

test('editing the limits: checked, saved, and a broken file falls back to the defaults', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'q-')), 'usage-limits.json'); assert.deepEqual(Q.loadLimits(f), Q.DEFAULT_LIMITS, 'no file: the defaults');
  const saved = Q.saveLimits(f, [{ match: ' Flash-Lite ', name: 'Lite', rpm: '30', tpm: '', rpd: 1500 }, { match: 'flash', rpm: 10, tpm: 250000, rpd: 250 }]); assert.deepEqual(saved[0], { match: 'flash-lite', name: 'Lite', rpm: 30, tpm: null, rpd: 1500 }); assert.equal(saved[1].name, 'flash', 'no name: the match is used'); assert.deepEqual(Q.loadLimits(f), saved);
  assert.throws(() => Q.saveLimits(f, []), /between 1 and 12/); assert.throws(() => Q.saveLimits(f, [{ match: '' }]), /part of the model name/); assert.throws(() => Q.saveLimits(f, [{ match: 'x', rpd: 'abc' }]), /RPD must be a number/); assert.throws(() => Q.saveLimits(f, [{ match: 'x', rpm: -1 }]), /RPM must be a number/); assert.throws(() => Q.saveLimits(f, Array(13).fill({ match: 'x' })), /between 1 and 12/);
  assert.deepEqual(Q.loadLimits(f), saved, 'a refused save changes nothing'); fs.writeFileSync(f, '{broken'); assert.deepEqual(Q.loadLimits(f), Q.DEFAULT_LIMITS);
});

test('per-model use against the limits: this is Zee\'s own screenshot (3.8 Flash 17 of 20 a day and 5 of 5 a minute; Flash Lite over its token limit)', () => {
  let t = new Date('2026-09-21T13:00:00Z'); const u = createUsage({ file: () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qu-')), 'u.json'), now: () => t });
  for (let i = 0; i < 17; i++) { t = new Date(t.getTime() + 2000); u.add({ model: 'gemini-3.8-flash', inTok: 1500, outTok: 200 }); }
  for (let i = 0; i < 3; i++) u.add({ model: 'gemini-3.8-flash', inTok: 100, outTok: 10, failed: true });
  u.add({ model: 'gemini-3.5-flash-lite', inTok: 314000, outTok: 900 }); u.add({ source: 'hermes', model: 'gemini-3.5-flash-lite', run: true, inTok: 40000, outTok: 2000 }); u.add({ model: 'gemini-3.8-live', inTok: 3000, outTok: 100 });
  const snap = u.snapshot(); assert.ok(snap.minuteByModel, 'the snapshot has the last minute for each model'); assert.equal(snap.minuteByModel['gemini-3.8-flash'].req, 20, 'all 20 tries were in the last minute (17 + 3 failed)');
  const v = Q.view(snap, Q.DEFAULT_LIMITS), by = Object.fromEntries(v.map(r => [r.model, r]));
  assert.equal(by['gemini-3.8-flash'].req, 20); assert.deepEqual(by['gemini-3.8-flash'].rpd, { used: 20, limit: 20, pct: 100 }); assert.equal(by['gemini-3.8-flash'].rpm.pct, 400, 'far over the 5 a minute'); assert.equal(by['gemini-3.8-flash'].level, 'hot'); assert.equal(by['gemini-3.8-flash'].fail, 3);
  assert.equal(by['gemini-3.5-flash-lite'].tpm.used, 354000, 'the crew\'s tokens count too'); assert.equal(by['gemini-3.5-flash-lite'].tpm.pct, 142); assert.equal(by['gemini-3.5-flash-lite'].crewRuns, 1); assert.equal(by['gemini-3.5-flash-lite'].rpd.pct, 0, 'the crew\'s own requests are not counted (only its tokens): AI Studio has the true number');
  assert.equal(by['gemini-3.8-live'].rpd, null, 'voice has no daily cap'); assert.equal(by['gemini-3.8-live'].level, 'ok'); assert.deepEqual(v.map(r => r.level).slice(0, 2), ['hot', 'hot'], 'the worst come first');
  const empty = Q.view({ rows: [] }, Q.DEFAULT_LIMITS, { focus: ['gemini-3.8-flash'] }); assert.equal(empty.length, 1, 'your everyday model is shown even before you use it'); assert.deepEqual(empty[0].rpd, { used: 0, limit: 20, pct: 0 }); assert.deepEqual(Q.view(null, []), []);
  const unknown = Q.view({ rows: [{ source: 'bridge', model: 'gemini-9-pro', req: 4, inTok: 1, outTok: 1, fail: 0, runs: 0 }] }, Q.DEFAULT_LIMITS)[0]; assert.equal(unknown.known, false); assert.equal(unknown.name, 'Gemini 9 Pro'); assert.equal(unknown.rpd, null);
});

test('warnings: once at 80% of the day, once when it is full, and only the day\'s allowance warns early; a new day starts again', () => {
  const got = []; let day = '2026-09-21'; const check = Q.createWatcher({ day: () => day, emit: e => got.push(e) });
  const row = (req, rpm = 0) => [{ model: 'gemini-3.8-flash', name: 'Flash', rpd: { used: req, limit: 20, pct: Math.round(req / 20 * 100) }, rpm: { used: rpm, limit: 5, pct: Math.round(rpm / 5 * 100) }, tpm: null }];
  check(row(10)); assert.equal(got.length, 0); check(row(16)); assert.equal(got.length, 1); assert.deepEqual([got[0].kind, got[0].level], ['rpd', 80]); assert.match(got[0].text, /^Flash: 16 of 20 requests today used \(80%\)\.$/); check(row(17)); assert.equal(got.length, 1, 'not again');
  check(row(20)); assert.equal(got.length, 2); assert.equal(got[1].level, 100); assert.match(got[1].text, /the limit for requests today is reached \(20 of 20\)\. It starts again when the day resets\./);
  check(row(20, 4)); assert.equal(got.length, 2, '80% of a minute is normal: no warning'); check(row(20, 5)); assert.equal(got.length, 3); assert.equal(got[2].kind, 'rpm'); assert.match(got[2].text, /It clears within a minute/);
  day = '2026-09-22'; check(row(20)); assert.equal(got.length, 4, 'a new day: told again');
});

test('the models a key can use: everyday Flash models only, the stable newest Lite is recommended, previews come last, voice models are kept apart', () => {
  const api = [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.9-flash-lite-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-live', supportedGenerationMethods: ['bidiGenerateContent'] }, { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.8-flash-image', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-3.8-pro', supportedGenerationMethods: ['generateContent'] }, { name: 'models/text-bison', supportedGenerationMethods: ['generateContent'] }];
  const r = Q.pickModels(api, Q.DEFAULT_LIMITS); assert.deepEqual(r.everyday.map(m => m.id), ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.9-flash-lite-preview'], 'no voice, image, speech, embedding or pro'); assert.equal(r.recommended, 'gemini-3.5-flash-lite', 'the newest Lite that is not a preview'); assert.deepEqual(r.live, ['gemini-3.8-live']);
  assert.equal(r.everyday[1].limit.rpd, 500); assert.equal(r.everyday[0].limit.rpd, 20); assert.equal(r.everyday[3].preview, true); assert.equal(Q.pickModels([], []).recommended, null);
  assert.equal(Q.validModelId('gemini-3.5-flash-lite'), true); for (const bad of ['', 'gpt-4', 'gemini-', 'gemini-x y', '../gemini-3', 'gemini-3.5-flash-lite;rm']) assert.equal(Q.validModelId(bad), false, bad);
});

test('asking Google for the model list: the key is sent as a header, and every failure is a sentence', async () => {
  const seen = []; const ok = await Q.listModels({ apiKey: 'K' }, Q.DEFAULT_LIMITS, async (url, o) => { seen.push([url, o.headers['x-goog-api-key']]); return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) }; }); assert.equal(ok.recommended, 'gemini-3.5-flash-lite'); assert.ok(!seen[0][0].includes('K') || !/key=/.test(seen[0][0]), 'never in the address'); assert.equal(seen[0][1], 'K');
  await assert.rejects(Q.listModels({ apiKey: '' }, [], async () => ({})), /No Gemini key/); await assert.rejects(Q.listModels({ apiKey: 'K' }, [], async () => ({ ok: false, status: 403 })), /Google answered 403/);
});
