'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Home } = require('../lib/home');
const { HermesEngine, providerSetup, makeSseParser } = require('../lib/hermes');
const { hermesCmd, hasHermes } = require('./helpers');

test('providerSetup maps Orbit settings to Hermes config', () => {
  const g = providerSetup({ workerProvider: 'gemini', apiKey: 'GKEY', textModel: 'gemini-x' });
  assert.match(g.modelYaml, /provider: gemini/); assert.match(g.modelYaml, /default: 'gemini-x'/); assert.equal(g.env.GEMINI_API_KEY, 'GKEY'); assert.doesNotMatch(g.modelYaml, /GKEY/);
  const o = providerSetup({ workerProvider: 'openrouter', workerModel: 'anthropic/claude-sonnet', workerApiKey: 'OK' });
  assert.equal(o.env.OPENROUTER_API_KEY, 'OK'); assert.match(o.modelYaml, /provider: openrouter/);
  const c = providerSetup({ workerProvider: 'custom', workerModel: "it's", workerApiKey: 'K', workerBaseUrl: 'http://h/v1' });
  assert.match(c.modelYaml, /base_url: 'http:\/\/h\/v1'/); assert.match(c.modelYaml, /default: 'it''s'/);
  assert.throws(() => providerSetup({ workerProvider: 'openrouter', workerApiKey: 'x' }), /model/);
  assert.throws(() => providerSetup({ workerProvider: 'gemini', textModel: 'm' }), /Gemini key/);
  assert.throws(() => providerSetup({ workerProvider: 'custom', workerModel: 'm', workerApiKey: 'k' }), /base URL/);
});

test('SSE parser handles events split across chunks', () => {
  const got = []; const feed = makeSseParser(b => got.push(b));
  const full = 'data: {"a":1}\n\nevent: hermes.tool.progress\ndata: {"tool":"terminal"}\n\ndata: [DONE]\n\n';
  for (let i = 0; i < full.length; i += 7) feed(full.slice(i, i + 7));
  assert.deepEqual(got.map(g => g.event), ['message', 'hermes.tool.progress', 'message']);
  assert.equal(JSON.parse(got[1].data).tool, 'terminal');
});

const has = hasHermes();
test('real Hermes: a crew agent runs a job through its own API server and writes a file', { skip: !has && 'hermes is not installed here', timeout: 240000 }, async () => {
  const port = 11600 + Math.floor(Math.random() * 200);
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock-openai.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-h-')); const home = new Home(path.join(root, 'BridgeHome')).ensure();
  const cfg = { aiName: 'Nova', gender: 'female', userName: 'Zee', userTitle: 'CEO', lang: 'mix', engine: 'hermes', hermesPath: hermesCmd(), workerProvider: 'custom', workerModel: 'mock-model', workerApiKey: 'mock-key-1234567890', workerBaseUrl: `http://127.0.0.1:${port}/v1` };
  const engine = new HermesEngine({ home, getCfg: () => cfg });
  try {
    const agent = home.createAgent({ name: 'Alice', role: 'Developer', personality: 'Careful and fast.' });
    const events = [];
    const report = await engine.runTask(agent, 'Create proof.txt in your workspace.', { onProgress: e => events.push(e) });
    assert.match(report, /proof\.txt/);
    assert.ok(events.some(e => e.tool === 'terminal' && e.status === 'running'), 'live tool progress arrives');
    assert.ok(events.some(e => e.tool === 'terminal' && e.status === 'completed'));
    const f = path.join(home.p('workspace', 'alice'), 'proof.txt');
    assert.ok(fs.existsSync(f), 'file lands in the agent workspace, not the home folder');
    assert.match(fs.readFileSync(f, 'utf8'), /hello-from-crew/);
    const soul = fs.readFileSync(path.join(engine.profileDir('alice'), 'SOUL.md'), 'utf8');
    assert.match(soul, /You are Alice/); assert.match(soul, /Careful and fast/);
    assert.ok(engine.status('alice').running);
    // engine.check() goes through the same path
    const steps = await engine.check({ smoke: true });
    assert.ok(steps.every(s => s.ok), JSON.stringify(steps));
  } finally { engine.stopAll(); mock.kill(); }
  await new Promise(r => setTimeout(r, 500));
  assert.equal(engine.status('alice').running, false);
});

test('workers route jobs to Hermes when the engine is hermes', { skip: !has && 'hermes is not installed here', timeout: 240000 }, async () => {
  const { EventEmitter } = require('events'); const { createWorkers } = require('../lib/workers');
  const port = 11800 + Math.floor(Math.random() * 150);
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock-openai.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-w-')); const home = new Home(path.join(root, 'BridgeHome')).ensure();
  const cfg = { aiName: 'Nova', gender: 'female', userName: 'Zee', userTitle: 'CEO', lang: 'mix', engine: 'hermes', hermesPath: hermesCmd(), workerProvider: 'custom', workerModel: 'mock-model', workerApiKey: 'mock-key-1234567890', workerBaseUrl: `http://127.0.0.1:${port}/v1` };
  const engine = new HermesEngine({ home, getCfg: () => cfg }); const bus = new EventEmitter();
  const workers = createWorkers({ home, getCfg: () => cfg, gemini: { runLoop: async () => { throw new Error('built-in loop must not run'); } }, tools: { declarationsFor: () => [], exec: async () => ({}) }, bus, hermes: engine });
  const seen = []; bus.on('job:progress', e => seen.push(e.tool + ':' + e.status)); const states = []; bus.on('agent:state', e => states.push(e.state));
  try {
    const agent = home.createAgent({ name: 'Bilal', role: 'Developer' });
    const done = new Promise(res => bus.once('job:done', res));
    workers.dispatch(agent.id, 'Create proof.txt in your workspace.');
    const { job } = await done;
    assert.equal(job.status, 'done', job.error); assert.equal(job.engine, 'hermes'); assert.match(job.result, /proof\.txt/);
    assert.ok(seen.includes('terminal:running')); assert.ok(states.includes('working')); assert.equal(states[states.length - 1], 'idle');
    assert.ok(fs.existsSync(path.join(home.p('workspace', 'bilal'), 'proof.txt')));
  } finally { engine.stopAll(); mock.kill(); }
});

// A fake hermes in a directory whose name contains a space. Verifies that DEP0190 is fixed:
// the full path is quoted, so detect() runs the fake and reports its version.
test('detect runs a hermes whose path contains a space', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-sp '));
  const home = new Home(path.join(root, 'BridgeHome')).ensure();
  const bin = path.join(root, 'fake hermes');
  let exe;
  if (process.platform === 'win32') {
    exe = bin + '.cmd';
    fs.writeFileSync(exe, '@echo off\r\necho Hermes Agent v9.9.9\r\n');
  } else {
    exe = bin;
    fs.writeFileSync(exe, '#!/bin/sh\necho "Hermes Agent v9.9.9"\n', { mode: 0o755 });
  }
  const cfg = { aiName: 'Nova', gender: 'female', userName: 'Zee', userTitle: 'CEO', lang: 'mix', engine: 'hermes', hermesPath: exe, workerProvider: 'custom', workerModel: 'm', workerApiKey: 'k', workerBaseUrl: 'http://127.0.0.1:1/v1' };
  const engine = new HermesEngine({ home, getCfg: () => cfg });
  const d = await engine.detect();
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.match(d.version, /9\.9\.9/);
});
