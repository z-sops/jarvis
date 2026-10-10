'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const gm = require('../lib/gemini'), { HermesEngine } = require('../lib/hermes');
const { makeTrail, meter } = require('../lib/jobreport');
const { createWorkers } = require('../lib/workers'), { Home } = require('../lib/home');
const { EventEmitter } = require('node:events'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
test('Gemini telemetry measures submitted/received UTF-8 bodies and does not expose payload or credentials', async t => {
  const previous = global.fetch; t.after(() => { global.fetch = previous; }); const observed = []; let submitted;
  const response = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'سلام 👋' }] } }] });
  global.fetch = async (_url, options) => { submitted = options.body; return { ok: true, text: async () => response }; };
  const result = await gm.runLoop({ cfg: { apiKey: 'fixture-key', textModel: 'fixture' }, system: 'Fixture', contents: [{ role: 'user', parts: [{ text: 'سلام' }] }], tools: [], exec: async () => ({}), onTransport: e => observed.push(e) });
  assert.equal(result.text, 'سلام 👋'); assert.equal(observed[0].bytes, Buffer.byteLength(submitted)); assert.equal(observed[1].bytes, Buffer.byteLength(response)); assert.ok(observed[1].bytes > response.length);
  assert.equal(JSON.stringify(observed).includes('fixture-key'), false); assert.equal(JSON.stringify(observed).includes('سلام'), false);
});
test('a broken telemetry listener never retries or breaks a successful Gemini request', async t => {
  const previous = global.fetch; t.after(() => { global.fetch = previous; }); let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, text: async () => JSON.stringify({ candidates: [] }) }; };
  await gm.generate({ apiKey: 'fixture', textModel: 'fixture' }, {}, undefined, undefined, undefined, undefined, () => { throw new Error('listener'); }); assert.equal(calls, 1);
});
function engine() {
  const e = new HermesEngine({ requireContainment: false, home: {}, getCfg: () => ({}) }); e.ensureServer = async () => ({ busy: 0, key: 'fixture', port: 1 }); e.writeSoul = () => {}; return e;
}
test('Hermes connection loss after dispatch is not replayed or used to restart/repost a job', async t => {
  const previous = global.fetch; t.after(() => { global.fetch = previous; }); let calls = 0, restarts = 0; const e = engine(); e.stop = () => { restarts++; };
  global.fetch = async () => { calls++; throw new Error('Simulated response lost after server accepted the request'); };
  await assert.rejects(e.runTask({ id: 'alex' }, 'Fixture'), /outcome may be unknown/); assert.equal(calls, 1); assert.equal(restarts, 0);
});
test('Hermes counts actual SSE chunks once, independently of rendered text and usage events', async t => {
  const previous = global.fetch; t.after(() => { global.fetch = previous; }); let submitted; const seen = [], text = [];
  const bytes = Buffer.from('data: ' + JSON.stringify({ choices: [{ delta: { content: 'سلام 👋' } }] }) + '\n\ndata: [DONE]\n\n');
  global.fetch = async (_url, opts) => { submitted = opts.body; return { ok: true, body: (async function* () { yield bytes.subarray(0, 17); yield bytes.subarray(17); })() }; };
  const report = await engine().runTask({ id: 'alex' }, 'Fixture', { onTransport: e => seen.push(e), onText: s => text.push(s) });
  assert.equal(report, 'سلام 👋'); assert.equal(text.at(-1), report); assert.equal(seen[0].bytes, Buffer.byteLength(submitted)); assert.equal(seen.filter(e => e.kind === 'received').reduce((n, e) => n + e.bytes, 0), bytes.length);
});
test('rendered text cannot fabricate transport or packet activity; invalid byte counts are ignored', () => {
  const trail = makeTrail(() => 1000), job = { id: 'job-test', task: 'Fixture' }; trail.begin('alex', job); trail.text('alex', job, 'سلام 👋');
  let snap = trail.snapshot('alex'); assert.equal(snap.bytes, 0); assert.equal(snap.textBytes, Buffer.byteLength('سلام 👋'));
  for (const bytes of [-1, NaN, Infinity, 1.5]) trail.transport('alex', job, { kind: 'received', source: 'gemini_http_body', bytes });
  trail.transport('alex', job, { kind: 'submitted', source: 'gemini_http_body', bytes: 120 }); snap = trail.snapshot('alex'); assert.equal(snap.bytes, 0); assert.equal(snap.submittedBytes, 120); assert.equal(snap.attempts, 1); assert.match(meter(snap, 5000), /No packet measurement/);
});
test('worker persists only measured counters and ignores late telemetry after the run ends', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-transport-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = new Home(root).ensure(); home.createAgent({ name: 'Alex' }); const bus = new EventEmitter(); let late;
  const workers = createWorkers({ home, bus, getCfg: () => ({ engine: 'builtin' }), tools: { declarationsFor: () => [] }, gemini: { runLoop: async ({ onTransport }) => {
    late = onTransport; onTransport({ kind: 'submitted', source: 'gemini_http_body', bytes: 100 }); onTransport({ kind: 'received', source: 'gemini_http_body', bytes: 200 }); return { text: 'Report' };
  } } });
  const done = new Promise(resolve => bus.once('job:done', resolve)); workers.dispatch('alex', 'Fixture'); const j = (await done).job;
  assert.equal(j.activity.submittedBytes, 100); assert.equal(j.activity.receivedBytes, 200); late({ kind: 'received', source: 'gemini_http_body', bytes: 999 }); assert.equal(workers.activityOf('alex').receivedBytes, 200); assert.equal(new Home(root).ensure().findJob(j.id).activity.receivedBytes, 200);
});
