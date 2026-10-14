'use strict';
// Real modules with in-memory transports/engines. No sockets, subprocesses, model calls or filesystem writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createJobRuns } = require('../lib/job-runs');
const { createActorAuth } = require('../lib/gateway-auth');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function load(file, overrides = {}) {
  const filename = path.join(__dirname, '..', file), mod = { exports: {} }, real = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, __dirname: path.dirname(filename), require: n => overrides[n] || real(n), Buffer, AbortController, URL, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, console }, { filename });
  return mod.exports;
}
function registry() {
  const runs = createJobRuns(), ctl = new AbortController(), run = runs.begin('alex', 'job-a', ctl.signal);
  const auth = createActorAuth({ key: 'a'.repeat(64), isActiveActor: id => ['alex', 'bob'].includes(id), generationFor: runs.generationFor });
  return { runs, ctl, run, auth };
}
test('run tokens revoke immediately on abort/completion and never revive for the same actor or job ID', () => {
  const { runs, ctl, run, auth } = registry(), old = auth.tokenForActor('alex');
  assert.equal(auth.authenticate('alex', old), true); assert.equal(auth.tokenForActor('bob'), null);
  assert.throws(() => runs.begin('alex', 'other', new AbortController().signal), /active/);
  ctl.abort(); assert.equal(auth.authenticate('alex', old), false); assert.equal(auth.tokenForActor('alex'), null);
  const next = runs.begin('alex', 'job-a', new AbortController().signal);
  assert.notEqual(next.runId, run.runId); assert.notEqual(auth.tokenForActor('alex'), old);
  assert.equal(runs.end(run), false); assert.equal(runs.isCurrent(next), true);
  assert.equal(auth.authenticate('alex', old), false); runs.end(next); assert.equal(auth.tokenForActor('alex'), null);
  const aborted = new AbortController(); aborted.abort(); assert.throws(() => runs.begin('bob', 'job-b', aborted.signal));
  assert.throws(() => createActorAuth({ key: 'a'.repeat(64), isActiveActor: () => true }), /generation/);
});
test('parallel async contexts retain their run identity and stopped callbacks cannot affect the next run', async () => {
  const { runs, ctl, run } = registry(), bob = runs.begin('bob', 'job-b', new AbortController().signal), pause = deferred();
  const seen = [], callback = runs.guard(run, () => seen.push(runs.current().jobId));
  const p = runs.within(run, async () => { await pause.promise; assert.equal(runs.current(), run); assert.throws(runs.assertCurrent, /expired/); });
  await runs.within(bob, async () => { await Promise.resolve(); assert.equal(runs.current(), bob); });
  callback(); ctl.abort(); const next = runs.begin('alex', 'job-next', new AbortController().signal);
  callback(); pause.resolve(); await p; assert.deepEqual(seen, ['job-a']); assert.equal(runs.isCurrent(next), true);
});
test('HTTP requests authenticated before cancellation cannot dispatch a delayed body against a new run', async () => {
  const { runs, ctl, auth } = registry(); let handler, called = 0;
  const http = { createServer: fn => { handler = fn; return { on() {}, listen: (_, __, cb) => cb(), address: () => ({ port: 3039 }), close() {} }; } };
  const { createMcpServer } = load('lib/browser-mcp.js', { http, './browser-tools': { TOOLS: [{ name: 'browser_open' }], mcpTools: () => [], execute: () => { called++; return { text: 'ok' }; } } });
  const mcp = createMcpServer({ manager: {}, authenticate: auth.authenticate, bindRequest: runs.bind, assertCurrent: runs.assertCurrent }); await mcp.start();
  const req = new EventEmitter(); Object.assign(req, { url: '/mcp/alex', method: 'POST', headers: { host: '127.0.0.1:3039', authorization: 'Bearer ' + auth.tokenForActor('alex') } });
  const result = deferred(); const res = { writableEnded: false, writeHead(status) { this.status = status; }, end(body) { this.writableEnded = true; result.resolve({ status: this.status, body: JSON.parse(body) }); } };
  handler(req, res); ctl.abort(); runs.begin('alex', 'job-next', new AbortController().signal);
  req.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_open' } }))); req.emit('end');
  assert.equal((await result.promise).status, 401); assert.equal(called, 0); mcp.stop();
});
test('connector and native calls stopped while awaiting authorization do not invoke their providers', async () => {
  for (const native of [false, true]) {
    const { runs, ctl, run } = registry(), approval = deferred(); let called = 0;
    const c = { id: 'files', native: 'files', name: 'Files', enabled: true, tools: ['write'], roots: [] };
    const { Gateway } = load('lib/gateway.js', { './upstream': { Upstream: class {} } });
    const connectors = { get: () => c, visibleTo: () => true, levelOf: () => 'ask', nativeLevels: () => ({ web_search: 'ask' }) };
    const gw = new Gateway({ runs, connectors, hub: { authorize: () => approval.promise }, providers: { files: () => ({ sig: '[]', callTool: () => { called++; return { content: [] }; }, close() {} }) }, native: { web_search: () => { called++; return 'ok'; } } });
    try {
      const p = runs.within(run, () => gw.call('alex', native ? 'orbit__web_search' : 'files__write', {}));
      ctl.abort(); approval.resolve({ ok: true, how: 'once' });
      assert.equal((await p).isError, true); assert.equal(called, 0);
    } finally { await gw.closeAll(); }
  }
});
function workersRig(engine = 'hermes', failSnapshot = false) {
  const runs = createJobRuns(), bus = new EventEmitter(), events = [], jobs = new Map(), engines = [], memories = [], notes = [];
  const agent = { id: 'alex', name: 'Alex', engine }, trail = { begin() {}, add: (...a) => notes.push(a), text: (...a) => notes.push(a), say: (...a) => notes.push(a), data: (...a) => notes.push(a) };
  for (const name of ['job:progress', 'job:step', 'job:done', 'agent:state']) bus.on(name, data => events.push({ name, data }));
  const home = { p: (...a) => '/memory/' + a.join('/'), getAgent: () => agent, updateJob: (_, id, patch) => { const next = { ...jobs.get(id), ...patch }; jobs.set(id, next); return next; }, appendMemory: (_, m) => memories.push(m) };
  const invoke = options => { const d = deferred(); engines.push({ options, resolve: d.resolve }); return d.promise; };
  const hermes = { runTask: (_, __, options) => invoke(options) }, gemini = { runLoop: invoke };
  const { createWorkers } = load('lib/workers.js', { './persona': { buildAgentPrompt: () => '' }, './checkpoint': { createCard: () => ({ stepCount: 0, files: [] }), update: () => notes.push('checkpoint'), finish() {} }, './tags': { peek: () => [], wrapTask: (_, __, t) => t, markRead() {}, collectFromReport: (_, __, ___, ____, t) => t }, './anomaly': { check() {} }, './jobundo': { begin() {}, snapDir() { if (failSnapshot) throw new Error('snapshot failed'); }, note: (...a) => notes.push(a), diffDir() {}, end() {} }, './jobreport': { makeTrail: () => trail, progressNote: () => '' } });
  const tools = { declarationsFor: () => [], exec: () => { notes.push('executed'); return { ok: true }; } };
  const workers = createWorkers({ runs, home, bus, getCfg: () => ({}), hermes, gemini, tools });
  const job = id => { const j = { id, agent: 'alex', task: 'make an artifact', status: 'queued' }; jobs.set(id, j); return j; };
  return { runs, workers, engines, events, jobs, job, agent, memories, notes };
}
test('real worker lifecycle persists runId, revokes access on stop and ignores old engine callbacks during the next job', async () => {
  const r = workersRig(), first = r.workers.run(r.agent, r.job('a'));
  const old = r.engines[0]; assert.ok(r.jobs.get('a').runId); assert.equal(r.runs.generationFor('alex'), r.jobs.get('a').runId);
  assert.equal(r.workers.cancel('alex'), 1); assert.equal(r.runs.generationFor('alex'), null);
  old.resolve('success despite cancellation'); await first; assert.equal(r.jobs.get('a').status, 'cancelled'); assert.equal(r.memories.length, 0);
  const second = r.workers.run(r.agent, r.job('b')), n = r.events.length, trailCount = r.notes.length;
  old.options.onProgress({ tool: 'old', status: 'running' }); old.options.onText('old report'); old.options.onUsage({ prompt_tokens: 100 });
  assert.equal(r.events.length, n); assert.equal(r.notes.length, trailCount); assert.equal(r.workers.stateOf('alex').jobId, 'b');
  assert.notEqual(r.jobs.get('a').runId, r.jobs.get('b').runId);
  r.engines[1].resolve('new report'); await second; assert.equal(r.jobs.get('b').status, 'review'); assert.equal(r.runs.generationFor('alex'), null);
});
test('built-in callbacks and tool closures cannot write checkpoints or run tools after cancellation', async () => {
  const r = workersRig('builtin'), p = r.workers.run(r.agent, r.job('a')), old = r.engines[0].options;
  old.onStep({ name: 'read' }); old.onCheckpoint({ convo: [] }); r.workers.cancel('alex'); const count = r.notes.length, events = r.events.length;
  old.onStep({ name: 'write' }); old.onCheckpoint({ convo: [] }); old.onRetry({ status: 429 });
  assert.throws(() => old.exec('write_file', {}), /expired/); assert.equal(r.notes.length, count); assert.equal(r.events.length, events);
  r.engines[0].resolve({ text: 'old success' }); await p; assert.equal(r.jobs.get('a').status, 'cancelled');
});
test('setup failure cleans up the run and duplicate direct execution cannot replace a live job', async () => {
  const broken = workersRig('hermes', true); await broken.workers.run(broken.agent, broken.job('a'));
  assert.equal(broken.jobs.get('a').status, 'failed'); assert.equal(broken.runs.generationFor('alex'), null); assert.equal(broken.workers.stateOf('alex').state, 'idle');
  const r = workersRig(), p = r.workers.run(r.agent, r.job('a'));
  await assert.rejects(r.workers.run(r.agent, r.job('b')), /active job/); assert.equal(r.workers.stateOf('alex').jobId, 'a');
  r.engines[0].resolve('done'); await p;
});
test('browser dispatch refuses DOM and keyboard operations from an expired async context', async () => {
  const { runs, ctl, run } = registry();
  const { BrowserManager } = load('lib/browser.js', { './browser-policy': {} });
  const instance = new BrowserManager({ electron: { ipcMain: { on() {} } }, home: {}, getCfg: () => ({}), assertCurrent: runs.assertCurrent });
  assert.equal(instance.assertCurrent, runs.assertCurrent);
  const manager = Object.create(BrowserManager.prototype); manager.assertCurrent = runs.assertCurrent;
  let input = 0; const wc = { isLoading: () => false, send: () => input++, sendInputEvent: () => input++ };
  await runs.within(run, async () => { ctl.abort(); await assert.rejects(manager.op({ wc }, 'selectContents', {}), /expired/); await assert.rejects(manager.key(wc, 'Enter'), /expired/); });
  assert.equal(input, 0);
});
test('built-in shell approval arriving after stop cannot launch a command', async () => {
  const { runs, ctl, run } = registry(), approval = deferred(); let executed = 0;
  const { createTools } = load('lib/tools.js', { './home': { COMMANDER: 'jarvis' }, './jobundo': {}, './browser-tools': { NAMES: [], geminiDecls: () => ({}) }, './laila-tools': { decls: () => ({}), impl: () => ({}) }, './tags': { decls: () => ({}) } });
  const home = { root: '/memory', p: (...a) => '/memory/' + a.join('/'), getAgent: () => ({ name: 'Alex' }) };
  const tools = createTools({ home, getCfg: () => ({}), bus: { emit() {} }, runtime: { runs }, ask: () => approval.promise, shell: () => { executed++; } });
  const p = runs.within(run, () => tools.exec('run_shell', { command: 'echo harmless' }, 'alex'));
  ctl.abort(); approval.resolve('once'); const result = await p;
  assert.equal(result.ok, false); assert.match(result.error, /expired/); assert.equal(executed, 0);
});
test('Hermes does not post a task cancelled before or during server preparation', async () => {
  const { HermesEngine } = load('lib/hermes.js', { './persona': { buildAgentPrompt: () => '' } });
  const engine = Object.create(HermesEngine.prototype), ready = deferred(); let prepared = 0, posted = 0;
  engine.ensureServer = () => { prepared++; return ready.promise; }; engine._post = () => { posted++; }; engine.writeSoul = () => {};
  const ctl = new AbortController(); ctl.abort(new Error('stop'));
  await assert.rejects(engine.runTask({ id: 'alex' }, 'task', { signal: ctl.signal }), /stop/); assert.equal(prepared, 0);
  const live = new AbortController(), p = engine.runTask({ id: 'alex' }, 'task', { signal: live.signal }); live.abort(new Error('stop')); ready.resolve({ busy: 0 });
  await assert.rejects(p, /stop/); assert.equal(posted, 0);
});
