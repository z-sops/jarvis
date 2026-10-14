'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter } = require('events');
const { Home } = require('../lib/home');
const { createStore, VOICES } = require('../lib/store');
const { createTools } = require('../lib/tools');
const { createWorkers } = require('../lib/workers');
const gemini = require('../lib/gemini');
const { buildCommanderPrompt } = require('../lib/persona');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
function rig(askAnswer = 'deny') {
  const root = tmp(); const home = new Home(path.join(root, 'BridgeHome')).ensure();
  const cfg = { aiName: 'Nova', gender: 'female', userName: 'Zee', userTitle: 'Commander', lang: 'mix', apiKey: 'k', textModel: 'm' };
  const bus = new EventEmitter(); const events = []; bus.on('tool', e => events.push(e));
  const asked = [];
  const runtime = {}; const gm = { webSearch: async q => ({ answer: 'result for ' + q, sources: [] }), runLoop: async () => ({ text: 'all done' }) };
  const tools = createTools({ home, getCfg: () => cfg, gemini: gm, bus, ask: async r => { asked.push(r); return askAnswer; }, runtime, openExternal: async () => {}, shell: (c, o, cb) => cb(null, 'ok:' + c, '') });
  const workers = createWorkers({ home, getCfg: () => cfg, gemini: gm, tools, bus });
  Object.assign(runtime, { dispatch: workers.dispatch, stateOf: workers.stateOf });
  return { root, home, cfg, bus, events, asked, tools, workers };
}

test('store keeps voice consistent with gender', () => {
  const s = createStore(path.join(tmp(), 's.json'));
  assert.equal(s.set({ gender: 'male', voice: 'Kore' }).voice, VOICES.male[0].id);
  assert.equal(s.set({ gender: 'female', voice: 'Aoede' }).voice, 'Aoede');
});

test('agent folders: brain, jobs, skills, template, unique ids', () => {
  const { home } = rig();
  const a = home.createAgent({ name: 'Alice', role: 'Researcher', skills: ['market research'] });
  const b = home.createAgent({ name: 'Alice', role: 'Second' });
  assert.equal(a.id, 'alice'); assert.equal(b.id, 'alice-2');
  for (const d of ['brain', 'jobs', 'skills']) assert.ok(fs.existsSync(path.join(home.agentDir('alice'), d)), d);
  assert.ok(fs.existsSync(path.join(home.agentDir('alice'), 'brain/soul.md')));
  assert.equal(home.readSkills('alice').length, 1);
  assert.equal(home.getAgent('ALICE').id, 'alice');
  assert.throws(() => home.agentDir('../etc'));
});

test('permissions: workspace free, outside asks, shell always asks, dangerous denied, secrets denied', () => {
  const { tools, home } = rig();
  const d = (t, a, actor = 'commander') => tools.decide(t, a, actor).level;
  assert.equal(d('write_file', { path: 'notes.txt', content: 'x' }), 'allow');
  assert.equal(d('write_file', { path: path.join(os.homedir(), 'Desktop', 'x.txt'), content: 'x' }), 'ask');
  assert.equal(d('write_file', { path: path.join(os.homedir(), 'Desktop', 'x.txt'), content: 'x' }, 'alice'), 'deny');
  assert.equal(d('write_file', { path: 'run.bat', content: 'x' }), 'ask');
  assert.equal(d('read_file', { path: path.join(os.homedir(), '.ssh', 'id_rsa') }), 'deny');
  assert.equal(d('read_file', { path: home.p('jarvis/brain/soul.md') }), 'allow');
  assert.equal(d('read_file', { path: '/etc/hosts' }), 'ask');
  assert.equal(d('run_shell', { command: 'dir' }), 'ask');
  assert.equal(d('run_shell', { command: 'rm -rf /' }), 'deny');
  assert.equal(d('run_shell', { command: 'format c:' }), 'deny');
  assert.equal(d('open_url', { url: 'file:///etc/passwd' }), 'deny');
  assert.equal(d('open_url', { url: 'https://example.com' }), 'allow');
  assert.equal(d('create_agent', { name: 'x' }), 'allow');
});

test('exec: denial is reported honestly, approval executes, session grant sticks', async () => {
  let r = rig('deny');
  let out = await r.tools.exec('run_shell', { command: 'echo hi' });
  assert.equal(out.ok, false); assert.match(out.error, /declined/);
  assert.equal(r.asked.length, 1);

  r = rig('once');
  out = await r.tools.exec('run_shell', { command: 'echo hi' });
  assert.equal(out.ok, true); assert.match(out.stdout, /ok:echo hi/);

  r = rig('session');
  const target = path.join(r.root, 'outside', 'a.txt');
  assert.equal((await r.tools.exec('write_file', { path: target, content: '1' })).ok, true);
  assert.equal((await r.tools.exec('write_file', { path: path.join(r.root, 'outside', 'b.txt'), content: '2' })).ok, true);
  assert.equal(r.asked.length, 1, 'second write in same folder should not ask again');
  assert.equal(fs.readFileSync(target, 'utf8'), '1');
});

test('workers cannot use commander-only tools', async () => {
  const r = rig();
  const out = await r.tools.exec('create_agent', { name: 'Evil', role: 'x' }, 'alice');
  assert.equal(out.ok, false); assert.match(out.error, /Unknown tool/);
});

test('create_agent + assign_task end to end with background worker', async () => {
  const r = rig();
  const made = await r.tools.exec('create_agent', { name: 'Alice', role: 'Researcher', skills: ['research'] });
  assert.equal(made.ok, true);
  const done = new Promise(res => r.bus.once('job:done', res));
  const a = await r.tools.exec('assign_task', { agent: 'alice', task: 'find the dollar rate' });
  assert.equal(a.ok, true); assert.ok(a.job_id);
  const { job } = await done;
  assert.equal(job.status, 'review'); assert.equal(job.result, 'all done');
  assert.equal(r.home.listJobs('alice').length, 1);
  assert.match(r.home.readMemory('alice'), /Report ready for review/);
  const missing = await r.tools.exec('assign_task', { agent: 'nobody', task: 'x' });
  assert.equal(missing.ok, false);
});

test('gemini.runLoop executes tool calls then returns text (mocked fetch)', async () => {
  const realFetch = global.fetch; let n = 0; const seen = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); seen.push(body); n++;
    const parts = n === 1 ? [{ functionCall: { name: 'get_system_info', args: {} }, thoughtSignature: 'sig' }] : [{ text: 'Done, Commander.' }];
    return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }) };
  };
  try {
    const out = await gemini.runLoop({ cfg: { apiKey: 'k', textModel: 'm' }, system: 's', contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      tools: [{ name: 'get_system_info', parameters: { type: 'OBJECT', properties: {} } }], exec: async () => ({ ok: true }) });
    assert.equal(out.text, 'Done, Commander.');
    const second = seen[1].contents;
    assert.equal(second[1].parts[0].thoughtSignature, 'sig', 'model turn must be echoed back untouched');
    assert.equal(second[2].parts[0].functionResponse.name, 'get_system_info');
  } finally { global.fetch = realFetch; }
});

test('commander prompt carries name, gender grammar, language and crew', () => {
  const { home, cfg } = rig(); home.createAgent({ name: 'Bob', role: 'Coder' });
  const p = buildCommanderPrompt({ ...cfg, gender: 'male' }, home);
  assert.match(p, /You are Nova/); assert.match(p, /masculine forms/); assert.match(p, /Bob/); assert.match(p, /Roman Urdu/);
  assert.match(buildCommanderPrompt(cfg, home), /feminine forms/);
});
