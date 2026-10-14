'use strict';
// Per-worker engine/model routing: each agent can override the crew-wide engine (Settings > Crew
// engine) with its own -- e.g. Alex on OpenCode/Kimi, Bob on OpenCode/DeepSeek, Sara on the crew
// default. Covers lib/home.js's updateAgent() and lib/workers.js honouring agent.engine/agent.worker*.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter } = require('events');
const { Home } = require('../lib/home');
const { OpenCodeEngine } = require('../lib/opencode');
const { createWorkers } = require('../lib/workers');

function launcher(dir) {
  const FAKE = path.join(__dirname, 'fake-opencode.js');
  if (process.platform === 'win32') { const f = path.join(dir, 'opencode.cmd'); fs.writeFileSync(f, `@echo off\r\nnode "${FAKE}" %*\r\n`); return f; }
  const f = path.join(dir, 'opencode'); fs.writeFileSync(f, `#!/bin/sh\nexec node "${FAKE}" "$@"\n`, { mode: 0o755 }); return f;
}

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-route-'));
  const bin = launcher(dir);
  const home = new Home(path.join(dir, 'BridgeHome')).ensure();
  // Crew default: builtin (so a worker with no override never touches OpenCode by accident).
  const cfg = { aiName: 'Nova', engine: 'builtin', opencodePath: bin, workerProvider: 'custom', workerModel: 'crew-default-model', workerApiKey: 'crew-key', workerBaseUrl: 'http://127.0.0.1:1/v1' };
  const opencode = new OpenCodeEngine({ requireContainment: false, home, getCfg: () => cfg });
  const bus = new EventEmitter();
  const workers = createWorkers({ home, getCfg: () => cfg, gemini: { runLoop: async ({ contents }) => ({ text: 'builtin: ' + contents[0].parts[0].text }) }, tools: { declarationsFor: () => [], exec: async () => ({}) }, bus, opencode });
  return { home, cfg, workers, bus };
}

test('an agent with no override uses the crew default engine (builtin)', async () => {
  const { home, workers } = rig();
  const agent = home.createAgent({ name: 'Sara', role: 'Generalist' });
  const job = home.createJob(agent.id, 'hello');
  await workers.run(agent, job);
  const got = home.findJob(job.id);
  assert.equal(got.status, 'review', got.error);
  assert.match(got.result, /^builtin: hello/);
});

test('two agents run two different OpenCode models at the same time, each scoped to its own workspace', async () => {
  const { home, workers } = rig();
  const alex = home.createAgent({ name: 'Alex', role: 'Backend' });
  const bob = home.createAgent({ name: 'Bob', role: 'Frontend' });
  home.updateAgent(alex.id, { engine: 'opencode', workerProvider: 'custom', workerModel: 'kimi-k2', workerApiKey: 'alex-key', workerBaseUrl: 'http://127.0.0.1:1/v1' });
  home.updateAgent(bob.id, { engine: 'opencode', workerProvider: 'custom', workerModel: 'deepseek-v4-pro', workerApiKey: 'bob-key', workerBaseUrl: 'http://127.0.0.1:1/v1' });
  const alexAgent = home.getAgent(alex.id), bobAgent = home.getAgent(bob.id);

  const jobAlex = home.createJob(alex.id, 'Build the API');
  const jobBob = home.createJob(bob.id, 'Build the UI');
  await Promise.all([workers.run(alexAgent, jobAlex), workers.run(bobAgent, jobBob)]);

  const resAlex = home.findJob(jobAlex.id), resBob = home.findJob(jobBob.id);
  assert.equal(resAlex.status, 'review', resAlex.error);
  assert.equal(resBob.status, 'review', resBob.error);
  assert.equal(resAlex.engine, 'opencode'); assert.equal(resBob.engine, 'opencode');
  assert.match(resAlex.result, /model custom\/kimi-k2/);
  assert.match(resBob.result, /model custom\/deepseek-v4-pro/);

  const confAlex = JSON.parse(fs.readFileSync(path.join(home.p('workspace', 'alex'), 'opencode.json'), 'utf8'));
  const confBob = JSON.parse(fs.readFileSync(path.join(home.p('workspace', 'bob'), 'opencode.json'), 'utf8'));
  assert.equal(confAlex.model, 'custom/kimi-k2'); assert.equal(confBob.model, 'custom/deepseek-v4-pro');
});

test('home.updateAgent: blank clears a field back to inheriting the crew default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-upd-'));
  const home = new Home(path.join(dir, 'BridgeHome')).ensure();
  const a = home.createAgent({ name: 'Bilal', role: 'QA' });
  home.updateAgent(a.id, { engine: 'opencode', workerModel: 'glm-4.6' });
  let got = home.getAgent(a.id);
  assert.equal(got.engine, 'opencode'); assert.equal(got.workerModel, 'glm-4.6');
  home.updateAgent(a.id, { engine: '' });
  got = home.getAgent(a.id);
  assert.equal('engine' in got, false, 'a blank field is removed, not stored as an empty string');
  assert.equal(got.workerModel, 'glm-4.6', 'other overrides are untouched');
});

test('home.updateAgent rejects an unknown agent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-upd2-'));
  const home = new Home(path.join(dir, 'BridgeHome')).ensure();
  assert.throws(() => home.updateAgent('no-such-agent', { engine: 'opencode' }), /Unknown agent/);
});

test('explicit built-in workers honor separate Gemini keys/models without mutating commander defaults', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-builtin-model-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const home=new Home(root).ensure(),bus=new EventEmitter(),seen=[];
  const shared={engine:'hermes',apiKey:'COMMANDER_FIXTURE',textModel:'commander-model'};
  for(const name of ['Alex','Bob']){home.createAgent({name});home.updateAgent(name.toLowerCase(),{engine:'builtin',workerProvider:'gemini',workerModel:name+'-model',workerApiKey:name+'-key'});}
  const workers=createWorkers({home,bus,getCfg:()=>shared,tools:{declarationsFor:()=>[]},gemini:{runLoop:async o=>{seen.push({actor:o.agentId,key:o.cfg.apiKey,model:o.cfg.textModel});return {text:'Review report'};}}});t.after(()=>workers.cancelAll());
  await Promise.all(home.listAgents().map(a=>workers.run(a,home.createJob(a.id,'Inspect'))));
  assert.deepEqual(seen.sort((a,b)=>a.actor.localeCompare(b.actor)),[{actor:'alex',key:'Alex-key',model:'Alex-model'},{actor:'bob',key:'Bob-key',model:'Bob-model'}]);assert.equal(shared.apiKey,'COMMANDER_FIXTURE');assert.equal(shared.textModel,'commander-model');
  const a=home.updateAgent('alex',{workerProvider:'custom'}),j=home.createJob('alex','Unsupported provider');await workers.run(a,j);assert.equal(home.findJob(j.id).status,'failed');assert.match(home.findJob(j.id).error,/Gemini only/);assert.equal(seen.length,2);
});
