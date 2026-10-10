'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const yaml = require('js-yaml'), { Home } = require('../lib/home'), { Library } = require('../lib/library');
const { createCrewConfig, parse, register } = require('../lib/crew-config');
const { atomicWrite } = require('../lib/job-storage');
function rig(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-crew-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = new Home(root).ensure(); home.createAgent({ name: 'Alex', role: 'Developer' }); home.createAgent({ name: 'Bob', role: 'Tester' });
  const library = new Library(home); library.saveSkill({ name: 'Code review', body: 'Review the code and report evidence.' }); library.createPack({ name: 'Manual' });
  const cfg = { engine: 'builtin', workerProvider: 'gemini', apiKey: 'private-fixture-do-not-export' };
  const service = createCrewConfig({ home, library, getCfg: () => cfg, ...options });
  return { home, library, cfg, service, options };
}
function edited(r, edit = d => { d.workers[0].config.workerModel = 'fixture-model'; }) { const d = parse(r.service.export().text); edit(d); return yaml.dump(d); }
const receipt = r => JSON.parse(fs.readFileSync(r.home.p('logs', 'crew-config.json'))).events.at(-1);
test('export/preview are read-only; accepted config reuses Home/Library and preserves credentials and runtime records', t => {
  const r = rig(t); r.home.updateAgent('alex', { workerApiKey: 'worker-private-fixture', workerBaseUrl: 'https://private.invalid/v1', allowCode: false });
  const job = r.home.createJob('alex', 'Old stopped work'); r.home.updateJob('alex', job.id, { status: 'interrupted' });
  const original = fs.readFileSync(r.home.p('agents', 'alex', 'agent.json'), 'utf8');
  const text = edited(r, d => { d.workers[0].config.workerModel = 'fixture-model'; d.workers[0].skills = ['code-review']; d.workers[0].packs = ['manual']; });
  assert.doesNotMatch(text, /private-fixture|workerApiKey|workerBaseUrl|allowCode|interrupted|Old stopped/);
  const p = r.service.preview(text); assert.equal(p.changes.length, 3); assert.equal(fs.readFileSync(r.home.p('agents', 'alex', 'agent.json'), 'utf8'), original); assert.equal(fs.existsSync(r.home.p('logs', 'crew-config.json')), false);
  const result = r.service.apply(p.token); assert.equal(result.changed, 3);
  assert.equal(r.home.getAgent('alex').workerModel, 'fixture-model'); assert.equal(r.home.getAgent('alex').workerApiKey, 'worker-private-fixture'); assert.equal(r.home.getAgent('alex').allowCode, false);
  assert.deepEqual(r.library.assignmentFor('alex'), { skills: ['code-review'], packs: ['manual'] }); assert.equal(r.home.findJob(job.id).status, 'interrupted');
  assert.equal(receipt(r).status, 'applied'); assert.equal(receipt(r).origin, 'human_main_window');
  assert.equal(receipt(r).resultRevision, r.service.export().revision); assert.throws(() => r.service.apply(p.token), /already used/);
});
test('strict YAML rejects authority, duplicate IDs/keys, aliases, types, multiple documents and unsafe model input', t => {
  const r = rig(t), base = parse(r.service.export().text);
  const rejected = [d => { d.workers[0].config.workerApiKey = 'never-print-this'; }, d => { d.workers[0].status = 'done'; }, d => { d.workers[0].permissions = ['shell']; }, d => { d.workers.push(d.workers[0]); }, d => { d.workers[0].id = '../escape'; }, d => { d.workers[0].config.workerContext = 1.5; }, d => { d.workers[0].config.engine = 'codex'; }, d => { d.workers[0].config.workerModel = '$(run-command)'; }, d => { d.workers[0].skills = ['../secret']; }];
  for (const edit of rejected) { const d = structuredClone(base); edit(d); assert.throws(() => parse(yaml.dump(d))); }
  for (const text of ['schemaVersion: 1\nschemaVersion: 1', 'x: &a [1]\ny: *a', 'x: !!js/function function(){}', '---\na: 1\n---\nb: 2', '__proto__: { polluted: true }', 'x: ' + '['.repeat(20) + '0' + ']'.repeat(20)]) assert.throws(() => parse(text));
  assert.throws(() => parse('x'.repeat(65537)), /64 KiB/); assert.equal({}.polluted, undefined);
});
test('missing workers/skills and unsupported built-in provider fail before writes', t => {
  const r = rig(t);
  for (const edit of [d => { d.workers[0].id = 'missing'; }, d => { d.workers[0].skills = ['missing']; }, d => { d.workers[0].config.workerProvider = 'openai'; }]) assert.throws(() => r.service.preview(edited(r, edit)));
  assert.equal(fs.existsSync(r.home.p('logs', 'crew-config.json')), false);
});
test('stale exports and previews conflict after worker/default/Library changes', t => {
  const r = rig(t); const old = edited(r), p = r.service.preview(old);
  r.home.updateAgent('bob', { workerModel: 'other-model' }); assert.throws(() => r.service.preview(old), /revision changed/); assert.throws(() => r.service.apply(p.token), /revision changed/);
  const p2 = r.service.preview(edited(r)); r.cfg.engine = 'hermes'; assert.throws(() => r.service.apply(p2.token), /revision changed/);
  const p3 = r.service.preview(edited(r)); r.library.setAssignment('bob', { skills: ['code-review'] }); assert.throws(() => r.service.apply(p3.token), /revision changed/);
});
test('preview expiry, process restart and home change never restore apply authority', t => {
  let clock = 0; const r = rig(t, { now: () => clock }); const p = r.service.preview(edited(r)); clock = 300001; assert.throws(() => r.service.apply(p.token), /expired/);
  const p2 = r.service.preview(edited(r)); assert.throws(() => createCrewConfig({ home: r.home }).apply(p2.token), /expired/);
  const p3 = r.service.preview(edited(r)); const oldRoot = r.home.root; r.home.root = oldRoot + '-other'; assert.throws(() => r.service.apply(p3.token), /expired/); r.home.root = oldRoot;
});
test('queued/running jobs, live activity, QA and recovery faults block applies', t => {
  const r = rig(t, { isBusy: () => r.busy }); r.busy = true;
  assert.throws(() => r.service.apply(r.service.preview(edited(r)).token), /active jobs/); r.busy = false;
  for (const status of ['queued', 'running', 'retrying']) {
    const j = r.home.createJob('bob', 'Job must stay unchanged'); r.home.updateJob('bob', j.id, { status });
    assert.throws(() => r.service.apply(r.service.preview(edited(r)).token), /Queued or running/); assert.equal(r.home.findJob(j.id).status, status); r.home.updateJob('bob', j.id, { status: 'cancelled' });
  }
  r.home.recoveryFaults.set('bob', 'bad'); assert.throws(() => r.service.apply(r.service.preview(edited(r)).token), /recovery faults/);
});
test('omitted workers remain untouched; null removes overrides; no-op does not create history', t => {
  const r = rig(t); assert.equal(r.service.apply(r.service.preview(r.service.export().text).token).changed, 0); assert.equal(fs.existsSync(r.home.p('logs', 'crew-config.json')), false);
  r.home.updateAgent('alex', { workerModel: 'old' }); const before = fs.readFileSync(r.home.p('agents', 'bob', 'agent.json'), 'utf8');
  const p = r.service.preview(edited(r, d => { d.workers = [d.workers[0]]; d.workers[0].config.workerModel = null; })); r.service.apply(p.token);
  assert.equal(r.home.getAgent('alex').workerModel, undefined); assert.equal(fs.readFileSync(r.home.p('agents', 'bob', 'agent.json'), 'utf8'), before);
});
test('durable intent failure prevents all worker writes', t => {
  const r = rig(t, { write: () => { throw new Error('fixture disk full'); } });
  const p = r.service.preview(edited(r)); assert.throws(() => r.service.apply(p.token), /disk full/); assert.equal(r.home.getAgent('alex').workerModel, undefined);
});
test('partial write survives restart, blocks imports and requires inspection of exact revision and receipts', t => {
  const r = rig(t); const oldSet = r.library.setAssignment.bind(r.library); r.library.setAssignment = () => { throw new Error('fixture power failure'); };
  assert.throws(() => r.service.apply(r.service.preview(edited(r)).token), /not fully verified/); assert.equal(r.home.getAgent('alex').workerModel, 'fixture-model'); assert.equal(receipt(r).status, 'partial');
  r.library.setAssignment = oldSet; const restarted = createCrewConfig({ home: r.home, library: r.library, getCfg: () => r.cfg });
  const current = restarted.export(); assert.equal(current.unresolved.length, 1); assert.throws(() => restarted.preview(current.text), /incomplete import/);
  assert.throws(() => restarted.acknowledge({ revision: current.revision, receiptIds: [] }), /history changed/);
  assert.throws(() => restarted.acknowledge({ revision: '0'.repeat(64), receiptIds: current.unresolved.map(e => e.id) }), /revision changed/);
  restarted.acknowledge({ revision: current.revision, receiptIds: current.unresolved.map(e => e.id) }); assert.equal(receipt(r).status, 'acknowledged'); assert.equal(restarted.export().unresolved.length, 0); assert.equal(restarted.apply(restarted.preview(restarted.export().text).token).changed, 0);
});
test('failure to save final receipt leaves a prepared/partial record, never a successful claim', t => {
  let n = 0; const r = rig(t, { write: (file, j) => { if (++n >= 2) throw new Error('fixture flush failure'); atomicWrite(file, j); } });
  assert.throws(() => r.service.apply(r.service.preview(edited(r)).token), /not fully verified/); assert.equal(receipt(r).status, 'prepared');
  assert.equal(createCrewConfig({ home: r.home, getCfg: () => r.cfg }).export().unresolved.length, 1);
});
test('damaged worker/assignment/job/history records fail closed instead of disappearing', t => {
  for (const target of ['agent', 'assignments', 'job', 'journal']) {
    const r = rig(t); let file;
    if (target === 'agent') file = r.home.p('agents', 'bob', 'agent.json');
    if (target === 'assignments') file = r.library.p('assignments.json');
    if (target === 'journal') file = r.home.p('logs', 'crew-config.json');
    if (target === 'job') { const j = r.home.createJob('bob', 'Damaged'); file = r.home.p('agents', 'bob', 'jobs', j.id + '.json'); }
    const p = r.service.preview(edited(r)); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{broken');
    assert.throws(() => r.service.apply(p.token)); assert.equal(r.home.getAgent('alex').workerModel, undefined);
  }
});
test('symlinked configuration targets cannot redirect writes outside home', t => {
  const r = rig(t); const file = r.home.p('agents', 'alex', 'agent.json'), target = r.home.p('outside.json'); fs.renameSync(file, target);
  try { fs.symlinkSync(target, file); } catch (e) { if (e.code === 'EPERM') { t.skip('Symlink privilege unavailable'); return; } throw e; }
  assert.throws(() => r.service.export(), /symbolic links/); assert.equal(JSON.parse(fs.readFileSync(target)).id, 'alex');
});
test('IPC requires trusted main window for reads, previews, apply and acknowledgement', t => {
  const r = rig(t), handlers = new Map(); register({ home: r.home, getCfg: () => r.cfg, ipcMain: { handle: (n, f) => handlers.set(n, f) }, isTrusted: e => e.trusted === true });
  for (const op of ['export', 'preview', 'apply', 'acknowledge']) assert.equal(handlers.get('crew-config:' + op)({}, 'ignored').ok, false);
  const exported = handlers.get('crew-config:export')({ trusted: true }); assert.equal(exported.ok, true);
  const d = parse(exported.text); d.workers[0].config.workerModel = 'fixture';
  const p = handlers.get('crew-config:preview')({ trusted: true }, yaml.dump(d)); assert.equal(p.ok, true);
  assert.equal(handlers.get('crew-config:apply')({ trusted: true }, p.token).ok, true);
});
test('parser errors never echo document contents or unknown secret fields', t => {
  const r = rig(t); const secret = 'private-key-never-print'; assert.throws(() => parse(`x: [${secret}`), e => !e.message.includes(secret));
  assert.throws(() => parse(edited(r, d => { d[secret] = secret; })), e => !e.message.includes(secret));
});
test('50-worker import changes only accepted settings and preserves every worker identity', t => {
  const r = rig(t); for (let i = 0; i < 48; i++) r.home.createAgent({ name: `Worker ${i}` });
  const text = edited(r, d => { for (const w of d.workers) w.config.workerModel = 'fixture-batch'; });
  const p = r.service.preview(text); assert.equal(p.changes.length, 50); assert.equal(r.service.apply(p.token).changed, 50);
  assert.equal(r.home.listAgents().length, 50); assert.ok(r.home.listAgents().every(a => a.workerModel === 'fixture-batch')); assert.equal(receipt(r).appliedWorkers.length, 50);
  r.home.createAgent({ name: 'Extra' }); assert.throws(() => r.service.export(), /50 existing/);
});
test('damaged Library pack metadata and redirected catalog entries cannot silently change the import view', t => {
  const r = rig(t), p = r.service.preview(edited(r)); fs.writeFileSync(r.library.p('packs', 'manual', 'pack.json'), '{broken');
  assert.throws(() => r.service.apply(p.token), /damaged/); assert.equal(r.home.getAgent('alex').workerModel, undefined);
});
test('locked credential storage denies configuration update and leaves protected record untouched', t => {
  const r = rig(t); r.home.updateAgent('alex', { workerApiKey: 'fixture-private' });
  r.home.secretStorage = { available: () => false }; const original = fs.readFileSync(r.home.p('agents', 'alex', 'agent.json'));
  assert.throws(() => r.service.apply(r.service.preview(edited(r)).token), /not fully verified/);
  assert.deepEqual(fs.readFileSync(r.home.p('agents', 'alex', 'agent.json')), original); assert.equal(receipt(r).status, 'partial');
});
test('model file tools cannot write or read configuration import authority/history', t => {
  const r = rig(t), { createTools } = require('../lib/tools');
  const tools = createTools({ home: r.home, getCfg: () => ({}), gemini: {}, bus: new (require('events').EventEmitter)(), ask: async () => 'once' });
  for (const actor of ['commander', 'alex']) for (const tool of ['write_file', 'read_file', 'list_dir']) assert.equal(tools.decide(tool, { path: r.home.p('logs', 'crew-config.json'), content: '{}' }, actor).level, 'deny');
});

test('incomplete-import quarantine blocks real worker dispatch before job creation or provider execution', t => {
  const r = rig(t), { createWorkers } = require('../lib/workers'); let providerCalls = 0;
  const workers = createWorkers({ home: r.home, getCfg: () => r.cfg, bus: new (require('events').EventEmitter)(), tools: {}, hermes: {}, gemini: { runLoop: () => { providerCalls++; } } });
  atomicWrite(r.home.p('logs', 'crew-config.json'), { version: 1, events: [{ id: 'crash-fixture', status: 'prepared', changes: [], appliedWorkers: [] }] });
  assert.throws(() => workers.dispatch('alex', 'Do not start'), /incomplete crew import/); assert.equal(r.home.listJobs('alex').length, 0); assert.equal(providerCalls, 0);
  const ex = r.service.export(); r.service.acknowledge({ revision: ex.revision, receiptIds: ex.unresolved.map(e => e.id) });
  assert.doesNotThrow(() => require('../lib/crew-config').assertReady(r.home));
});
