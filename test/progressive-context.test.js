'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { EventEmitter } = require('events');
const { Home } = require('../lib/home'), { Library } = require('../lib/library'), { LibraryProvider } = require('../lib/library-provider');
const { buildAgentPrompt } = require('../lib/persona'), { createTools } = require('../lib/tools');
const budget = require('../lib/context-budget');
function rig(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-progressive-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = new Home(root).ensure(), agent = home.createAgent({ name: 'Alex', role: 'Developer' }), bus = new EventEmitter();
  const cfg = { aiName: 'Laila', userName: 'Fixture', lang: 'en' }, tools = createTools({ home, getCfg: () => cfg, bus, runtime: {}, gemini: {}, ask: async () => 'deny', openExternal: async () => {}, shell() {} });
  return { root, home, agent, cfg, tools, lib: new Library(home) };
}
test('100 local skills inject metadata, not all instruction bodies; selected tool reads only own skill', async t => {
  const r = rig(t); r.home.createAgent({ name: 'Bob' });
  for (let i = 0; i < 100; i++) r.home.addSkill('alex', 'Skill '+i, 'Brief description.\n\nDEEP_BODY_CANARY_'+i+'\n'+'x'.repeat(2000));
  r.home.addSkill('bob', 'Private', 'OTHER_WORKER_CANARY');
  const prompt = buildAgentPrompt(r.cfg, r.home, r.agent);
  assert.doesNotMatch(prompt, /DEEP_BODY_CANARY|OTHER_WORKER_CANARY/); assert.match(prompt, /skill-99/);
  assert.ok(Buffer.byteLength(prompt) < 25000);
  assert.match(JSON.stringify(await r.tools.exec('use_skill', { name: 'skill-7', actor: 'bob' }, 'alex')), /DEEP_BODY_CANARY_7/);
  assert.doesNotMatch(JSON.stringify(await r.tools.exec('use_skill', { name: 'private' }, 'alex')), /OTHER_WORKER_CANARY/);
  assert.doesNotMatch(JSON.stringify(await r.tools.exec('use_skill', { name: '../bob/private' }, 'alex')), /OTHER_WORKER_CANARY/);
});
test('library L1 and contracts do not read references; L2 opens only the requested file', async t => {
  const r = rig(t);
  r.lib.saveSkill({ name: 'Testing', body: 'Steps', files: { 'references/one.md': 'FIRST_CANARY', 'references/two.md': 'SECOND_CANARY' } });
  r.lib.setAssignment('alex', { skills: ['testing'] }); const provider = new LibraryProvider({ library: r.lib });
  const original = fs.readFileSync, reads = [];
  fs.readFileSync = function(f, ...a) { reads.push(String(f)); return original.call(this, f, ...a); };
  try {
    await provider.callTool('skill_read', { name: 'testing' }, { actor: 'alex' });
    require('../lib/job-contract').build(r.home, r.agent, 'Test', { skills: ['testing'] });
    assert.equal(reads.some(f => f.endsWith('one.md') || f.endsWith('two.md')), false);
    const result = await provider.callTool('skill_read', { name: 'testing', path: 'references/one.md' }, { actor: 'alex' });
    assert.match(result.content[0].text, /FIRST_CANARY/); assert.equal(reads.some(f => f.endsWith('two.md')), false);
  } finally { fs.readFileSync = original; }
});
test('native MCP skill read uses authenticated actor and preserves explicit tool denial', async t => {
  const r = rig(t); r.home.createAgent({ name: 'Bob' });
  r.home.addSkill('alex', 'Own', 'OWN_CANARY'); r.home.addSkill('bob', 'Private', 'OTHER_CANARY');
  const { Connectors } = require('../lib/connectors'), { Hub } = require('../lib/hub'), { Gateway } = require('../lib/gateway');
  const connectors = new Connectors({ home: r.home }), gateway = new Gateway({ connectors, hub: new Hub({ ask: async () => 'deny' }),
    native: { use_skill: async (a, ctx) => { const out = await r.tools.exec('use_skill', a, ctx.actor); if (out.error) throw new Error(out.error); return out; } } });
  t.after(() => clearInterval(gateway.sweep));
  assert.match(JSON.stringify(await gateway.call('alex', 'orbit__use_skill', { name: 'own', actor: 'bob' })), /OWN_CANARY/);
  const denied = await gateway.call('alex', 'orbit__use_skill', { name: 'private', actor: 'bob' });
  assert.equal(denied.isError, true); assert.doesNotMatch(JSON.stringify(denied), /OTHER_CANARY/);
  connectors.setNativeLevel('use_skill', 'blocked'); assert.equal((await gateway.call('alex', 'orbit__use_skill', { name: 'own' })).isError, true);
});
test('revoked and oversized references are rejected without disclosing contents', async t => {
  const r = rig(t); r.lib.saveSkill({ name: 'Testing', body: 'Steps', files: { 'references/big.md': 'OVERSIZE_CANARY'+'x'.repeat(40000) } });
  r.lib.setAssignment('alex', { skills: ['testing'] }); const provider = new LibraryProvider({ library: r.lib });
  const out = await provider.callTool('skill_read', { name: 'testing', path: 'references/big.md' }, { actor: 'alex' });
  assert.equal(out.isError, true); assert.doesNotMatch(out.content[0].text, /OVERSIZE_CANARY/);
  r.lib.setAssignment('alex', { skills: [] }); assert.equal((await provider.callTool('skill_read', { name: 'testing' }, { actor: 'alex' })).isError, true);
});
test('mandatory goal/state and pinned notes are never silently trimmed to fit', t => {
  const r = rig(t); fs.writeFileSync(path.join(r.home.agentDir('alex'), 'brain', 'rules.md'), 'MANDATORY_STATE_'+'x'.repeat(140000));
  assert.throws(() => buildAgentPrompt(r.cfg, r.home, r.agent), e => e.contextBudget === true);
  fs.writeFileSync(path.join(r.home.agentDir('alex'), 'brain', 'rules.md'), 'Keep safety rules.');
  const notes = Array.from({ length: 650 }, () => '- [pin] 2026-09-20 18:29  '+ 'p'.repeat(250)).join('\n');
  const file = path.join(r.home.agentDir('alex'), 'brain/memory/notes.md'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, notes);
  assert.throws(() => buildAgentPrompt(r.cfg, r.home, r.agent), e => e.contextBudget === true);
  assert.equal(fs.readFileSync(file, 'utf8'), notes);
  assert.throws(() => budget.check({ goal: 'GOAL', state: 'x'.repeat(2000) }, 1024), e => e.contextBudget === true);
  assert.equal(budget.check('é').bytes, 2); assert.throws(() => budget.check('x', NaN), /Invalid/);
});
test('oversized job stops before external dispatch and retains its full goal', async t => {
  const r = rig(t), bus = new EventEmitter(); let calls = 0;
  const workers = require('../lib/workers').createWorkers({ home: r.home, bus, getCfg: () => ({ engine: 'hermes' }),
    hermes: { runTask: async () => { calls++; return 'Report'; } }, tools: {}, gemini: {} });
  t.after(() => workers.cancelAll());
  const done = new Promise(resolve => bus.once('job:done', resolve)), goal = 'MANDATORY_GOAL_'+'x'.repeat(140000);
  const j = workers.dispatch('alex', goal); await done;
  assert.equal(calls, 0); const saved = r.home.findJob(j.id); assert.equal(saved.status, 'failed'); assert.equal(saved.task, goal); assert.match(saved.error, /request budget/);
});
test('on-demand skill reads reject links to files outside their allowed skill scope', async t => {
  const r = rig(t), outside = path.join(r.root, 'outside.txt'); fs.writeFileSync(outside, 'OUTSIDE_CANARY');
  r.lib.saveSkill({ name: 'Testing', body: 'Steps', files: { 'references/linked.md': 'Placeholder' } });
  r.lib.setAssignment('alex', { skills: ['testing'] });
  const ref = r.lib.p('skills', 'testing', 'references', 'linked.md'); fs.unlinkSync(ref); fs.symlinkSync(outside, ref);
  const provider = new LibraryProvider({ library: r.lib });
  let out = await provider.callTool('skill_read', { name: 'testing', path: 'references/linked.md' }, { actor: 'alex' });
  assert.equal(out.isError, true); assert.doesNotMatch(JSON.stringify(out), /OUTSIDE_CANARY/);
  const body = r.lib.p('skills', 'testing', 'SKILL.md'); fs.unlinkSync(body); fs.symlinkSync(outside, body);
  out = await provider.callTool('skill_read', { name: 'testing' }, { actor: 'alex' }); assert.equal(out.isError, true); assert.doesNotMatch(JSON.stringify(out), /OUTSIDE_CANARY/);
  out = await provider.callTool('skill_list', {}, { actor: 'commander' }); assert.equal(out.isError, true); assert.doesNotMatch(JSON.stringify(out), /OUTSIDE_CANARY/);
});
test('full builtin request budget includes tool schemas and denies before the first network call', async t => {
  const old = global.fetch; let calls = 0; global.fetch = async () => { calls++; throw new Error('Unexpected network'); }; t.after(() => { global.fetch = old; });
  await assert.rejects(require('../lib/gemini').runLoop({ cfg: {}, system: 'GOAL', contents: [], tools: [{ name: 'test', description: 'x'.repeat(2000) }], exec: async () => ({}), requestBudgetBytes: 1024 }), e => e.contextBudget === true);
  assert.equal(calls, 0);
});
test('large tool result stops before next request without replaying the prior effect or deleting state', async t => {
  const old = global.fetch, submitted = []; let effects = 0;
  global.fetch = async (_url, options) => { submitted.push(JSON.parse(options.body)); return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'effect', args: {} } }] } }] }), { status: 200 }); };
  t.after(() => { global.fetch = old; });
  await assert.rejects(require('../lib/gemini').runLoop({ cfg: { apiKey: 'synthetic', textModel: 'fixture' }, system: 'KEEP_POLICY', contents: [{ role: 'user', parts: [{ text: 'KEEP_GOAL' }] }], tools: [], exec: async () => { effects++; return 'x'.repeat(3000); }, requestBudgetBytes: 1024 }), e => e.contextBudget === true);
  assert.equal(submitted.length, 1); assert.equal(effects, 1); assert.match(JSON.stringify(submitted[0]), /KEEP_POLICY/); assert.match(JSON.stringify(submitted[0]), /KEEP_GOAL/);
});
