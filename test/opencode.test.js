'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Home } = require('../lib/home');
const { OpenCodeEngine, providerSetup } = require('../lib/opencode');

test('providerSetup maps Orbit settings to an opencode.json provider block', () => {
  const g = providerSetup({ workerProvider: 'gemini', apiKey: 'GKEY', textModel: 'gemini-x' });
  assert.equal(g.model, 'google/gemini-x'); assert.equal(g.env.GEMINI_API_KEY, 'GKEY');
  assert.equal(g.provider.google.options.apiKey, '{env:GEMINI_API_KEY}');

  const o = providerSetup({ workerProvider: 'openrouter', workerModel: 'anthropic/claude-sonnet', workerApiKey: 'OK' });
  assert.equal(o.model, 'openrouter/anthropic/claude-sonnet'); assert.equal(o.env.OPENROUTER_API_KEY, 'OK');

  const c = providerSetup({ workerProvider: 'custom', workerModel: 'my-model', workerApiKey: 'K', workerBaseUrl: 'http://h/v1', workerContext: 64000 });
  assert.equal(c.model, 'custom/my-model');
  assert.equal(c.provider.custom.npm, '@ai-sdk/openai-compatible');
  assert.equal(c.provider.custom.options.baseURL, 'http://h/v1');
  assert.equal(c.provider.custom.models['my-model'].limit.context, 64000);
  assert.equal(c.env.BRIDGE_CREW_KEY, 'K');
  // the raw key is never written into the config itself, only an {env:...} reference
  assert.ok(!JSON.stringify(c.provider).includes('K"'));

  assert.throws(() => providerSetup({ workerProvider: 'openrouter', workerApiKey: 'x' }), /model/);
  assert.throws(() => providerSetup({ workerProvider: 'gemini', textModel: 'm' }), /Gemini key/);
  assert.throws(() => providerSetup({ workerProvider: 'custom', workerModel: 'm', workerApiKey: 'k' }), /base URL/);
});

function launcher(dir) {
  const FAKE = path.join(__dirname, 'fake-opencode.js');
  if (process.platform === 'win32') {
    const f = path.join(dir, 'opencode.cmd');
    fs.writeFileSync(f, `@echo off\r\nnode "${FAKE}" %*\r\n`);
    return f;
  }
  const f = path.join(dir, 'opencode');
  fs.writeFileSync(f, `#!/bin/sh\nexec node "${FAKE}" "$@"\n`, { mode: 0o755 });
  return f;
}

function engineFor(cfgExtra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-oc-'));
  const bin = launcher(dir);
  const home = new Home(path.join(dir, 'BridgeHome')).ensure();
  const cfg = { aiName: 'Nova', engine: 'opencode', opencodePath: bin, workerProvider: 'custom', workerModel: 'mock-model', workerApiKey: 'mock-key', workerBaseUrl: 'http://127.0.0.1:1/v1', ...cfgExtra };
  return { engine: new OpenCodeEngine({ home, getCfg: () => cfg }), home, cfg };
}

test('detect() runs the configured opencode command', async () => {
  const { engine } = engineFor();
  const d = await engine.detect();
  assert.ok(d.ok, JSON.stringify(d)); assert.match(d.version, /OpenCode/);
});

test('detect() reports a clear error when the command cannot run', async () => {
  const { engine } = engineFor({ opencodePath: path.join(os.tmpdir(), 'no-such-opencode-binary-xyz') });
  const d = await engine.detect();
  assert.equal(d.ok, false); assert.match(d.hint, /Settings/);
});

test('runTask scopes the job to the agent workspace and hands OpenCode the right model', async () => {
  const { engine, home } = engineFor();
  const agent = home.createAgent({ name: 'Alice', role: 'Developer' });
  const events = [];
  const report = await engine.runTask(agent, 'Create proof.txt', { onProgress: e => events.push(e) });
  assert.match(report, /Done: Create proof\.txt \(model custom\/mock-model\)/);
  assert.ok(events.some(e => e.status === 'running')); assert.ok(events.some(e => e.status === 'done'));
  const ws = home.p('workspace', 'alice');
  assert.ok(fs.existsSync(path.join(ws, 'proof.txt')), 'the file lands in the agent workspace');
  assert.match(fs.readFileSync(path.join(ws, 'proof.txt'), 'utf8'), /hello-from-opencode-crew/);
  const conf = JSON.parse(fs.readFileSync(path.join(ws, 'opencode.json'), 'utf8'));
  assert.equal(conf.model, 'custom/mock-model');
  assert.equal(conf.provider.custom.options.baseURL, 'http://127.0.0.1:1/v1');
});

test('runTask honours a per-agent cfgOverride (one agent on a different model than the crew default)', async () => {
  const { engine, home } = engineFor(); // crew default: custom/mock-model
  const agent = home.createAgent({ name: 'Carol', role: 'Developer' });
  const report = await engine.runTask(agent, 'Create proof.txt', { cfgOverride: { workerProvider: 'gemini', workerModel: 'gemini-override', workerApiKey: 'GKEY' } });
  assert.match(report, /model google\/gemini-override/);
  const conf = JSON.parse(fs.readFileSync(path.join(home.p('workspace', 'carol'), 'opencode.json'), 'utf8'));
  assert.equal(conf.model, 'google/gemini-override');
});

test('runTask throws with the agent stderr when the job fails', async () => {
  const { engine, home } = engineFor();
  const agent = home.createAgent({ name: 'Bob', role: 'Developer' });
  await assert.rejects(() => engine.runTask(agent, 'please fail this job'), /fake opencode: task asked to fail|OpenCode exited/);
});

test('check({smoke:true}) runs detect, providerSetup and one real turn', async () => {
  const { engine } = engineFor();
  const steps = await engine.check({ smoke: true });
  assert.ok(steps.every(s => s.ok), JSON.stringify(steps));
  assert.ok(steps.some(s => s.name === 'OpenCode found'));
  assert.ok(steps.some(s => s.name === 'One real turn with your model'));
});

test('workers route jobs to OpenCode when the engine is opencode', async () => {
  const { EventEmitter } = require('events'); const { createWorkers } = require('../lib/workers');
  const { engine, home, cfg } = engineFor();
  const bus = new EventEmitter();
  const workers = createWorkers({ home, getCfg: () => cfg, gemini: { runLoop: async () => { throw new Error('built-in loop must not run'); } }, tools: { declarationsFor: () => [], exec: async () => ({}) }, bus, opencode: engine });
  const seen = []; bus.on('job:progress', e => seen.push(e.tool + ':' + e.status)); const states = [];
  bus.on('agent:state', e => states.push(e.state));
  const agent = home.createAgent({ name: 'Bilal', role: 'Developer' });
  const job = home.createJob(agent.id, 'Create proof.txt');
  await workers.run(agent, job);
  const got = home.findJob(job.id);
  assert.equal(got.status, 'review', got.error); assert.equal(got.engine, 'opencode'); assert.match(got.result, /Done:/);
  assert.ok(seen.includes('opencode:running')); assert.ok(states.includes('working')); assert.equal(states[states.length - 1], 'idle');
  assert.ok(fs.existsSync(path.join(home.p('workspace', 'bilal'), 'proof.txt')));
});
