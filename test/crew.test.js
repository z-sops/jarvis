'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter } = require('events');
const { Home } = require('../lib/home');
const { createWorkers, minuteQuota } = require('../lib/workers');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function rig(cfgExtra = {}, hermes = null, gm = {}, usage = null) {
  const home = new Home(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-c-')), 'BridgeHome')).ensure(); home.createAgent({ name: 'Bob', role: 'Tester' });
  const cfg = { aiName: 'Nova', gender: 'female', userName: 'Zee', userTitle: 'Commander', lang: 'mix', engine: 'hermes', apiKey: 'k', textModel: 'm', ...cfgExtra };
  const bus = new EventEmitter(), done = [], progress = []; bus.on('job:done', e => done.push(e.job)); bus.on('job:progress', e => progress.push(e.label));
  const workers = createWorkers({ home, getCfg: () => cfg, gemini: gm, tools: { declarationsFor: () => [], exec: async () => ({}) }, bus, hermes, usage });
  return { home, bus, done, progress, workers };
}
const hang = calls => ({ runTask: (agent, task, { signal }) => new Promise((res, rej) => { calls.push(task); signal.addEventListener('abort', () => rej(signal.reason)); }) });
const until = async (f, ms = 3000) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await sleep(10); return f(); };

test('a running job can be cancelled and the agent becomes free', async () => {
  const calls = [], r = rig({}, hang(calls)); const job = r.workers.dispatch('bob', 'test the site');
  await until(() => r.workers.stateOf('bob').state === 'working'); assert.equal(r.workers.stateOf('bob').state, 'working');
  assert.equal(r.workers.cancel('bob'), 1); await until(() => r.done.length === 1);
  assert.equal(r.done[0].status, 'cancelled'); assert.equal(r.home.findJob(job.id).status, 'cancelled'); assert.equal(r.workers.stateOf('bob').state, 'idle');
});

test('jobs for one agent wait in line, the caller is told how many are ahead, and cancelling stops the whole line', async () => {
  const calls = [], r = rig({}, hang(calls));
  const j1 = r.workers.dispatch('bob', 'first'), j2 = r.workers.dispatch('bob', 'second'), j3 = r.workers.dispatch('bob', 'third');
  assert.equal(j1.queuedBehind, 0); assert.equal(j2.queuedBehind, 1); assert.equal(j3.queuedBehind, 2);
  await until(() => calls.length === 1); assert.deepEqual(calls.map(c => String(c).split('\n')[0]), ['first'], 'only one job runs at a time');
  assert.equal(r.workers.cancel('bob'), 3); await until(() => r.done.length === 3); await sleep(50);
  assert.deepEqual(r.done.map(j => j.status).sort(), ['cancelled', 'cancelled', 'cancelled']); assert.deepEqual(calls.map(c => String(c).split('\n')[0]), ['first'], 'the waiting jobs never started');
  assert.equal(r.workers.cancel('bob'), 0, 'nothing left to cancel'); assert.equal(r.workers.cancel('nobody'), 0);
});

test('a per-minute token quota is waited out once, then the job carries on', async () => {
  let n = 0; const err = new Error('Gemini HTTP 429 (RESOURCE_EXHAUSTED): You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 250000, model: gemini-3.5-flash-lite');
  const r = rig({ quotaWaitMs: 5 }, { runTask: async () => { if (++n === 1) throw err; return 'finished after the wait'; } });
  const job = r.workers.dispatch('bob', 'x'); await until(() => r.done.length === 1);
  assert.equal(n, 2); assert.equal(r.done[0].status, 'done'); assert.equal(r.done[0].result, 'finished after the wait'); assert.ok(r.progress.some(l => /waiting .*per-minute quota/.test(l)));
  assert.equal(minuteQuota(err.message), true);
});

test('a daily or per-request quota is NOT retried (waiting cannot fix it)', async () => {
  let n = 0; const daily = new Error('Gemini HTTP 429 (RESOURCE_EXHAUSTED): Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash');
  const r = rig({ quotaWaitMs: 5 }, { runTask: async () => { n++; throw daily; } });
  r.workers.dispatch('bob', 'x'); await until(() => r.done.length === 1); await sleep(30);
  assert.equal(n, 1); assert.equal(r.done[0].status, 'failed'); assert.match(r.done[0].error, /limit: 20/);
  assert.equal(minuteQuota(daily.message), false); assert.equal(minuteQuota('Gemini HTTP 503 high demand'), false); assert.equal(minuteQuota('quota exceeded, per day limit'), false);
});

test('the built-in engine stops too when its job is cancelled', async () => {
  const gm = { runLoop: async ({ shouldStop }) => { for (let i = 0; i < 300; i++) { if (shouldStop()) return { text: 'Cancelled.' }; await sleep(10); } return { text: 'finished' }; } };
  const r = rig({ engine: 'builtin' }, null, gm); r.workers.dispatch('bob', 'long job'); await until(() => r.workers.stateOf('bob').state === 'working');
  r.workers.cancel('bob'); await until(() => r.done.length === 1); assert.equal(r.done[0].status, 'cancelled');
});

test('Stop: cancelAll stops every agent that is running or waiting', async () => {
  const calls = [], r = rig({}, hang(calls)); r.home.createAgent({ name: 'Alex', role: 'Developer' });
  r.workers.dispatch('bob', 'one'); r.workers.dispatch('bob', 'two'); r.workers.dispatch('alex', 'three');
  await until(() => calls.length === 2); assert.equal(r.workers.cancelAll(), 3); await until(() => r.done.length === 3); await sleep(30);
  assert.deepEqual(r.done.map(j => j.status), ['cancelled', 'cancelled', 'cancelled']); assert.equal(calls.length, 2, 'the waiting job never started'); assert.equal(r.workers.cancelAll(), 0);
});

test('usage: a finished Hermes run reports its tokens with the model it used', async () => {
  const seen = []; const usage = { add: e => seen.push(e) };
  const r = rig({ textModel: 'gemini-3.5-flash-lite' }, { runTask: async (a, t, o) => { o.onUsage({ prompt_tokens: 120000, completion_tokens: 900, total_tokens: 120900 }); return 'done'; } }, {}, usage);
  r.workers.dispatch('bob', 'x'); await until(() => r.done.length === 1);
  assert.equal(seen.length, 1); assert.equal(seen[0].source, 'hermes'); assert.equal(seen[0].model, 'gemini-3.5-flash-lite'); assert.equal(seen[0].inTok, 120000); assert.equal(seen[0].outTok, 900); assert.equal(seen[0].run, true);
});
