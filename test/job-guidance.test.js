'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { Home } = require('../lib/home'), { createJobRuns } = require('../lib/job-runs');
const { createGuidance, stable, sha } = require('../lib/job-guidance');
const { createTools } = require('../lib/tools'), { createWorkers } = require('../lib/workers');
function rig(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-guidance-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = new Home(root).ensure(), agent = home.createAgent({ name: 'Alex' }), runs = createJobRuns();
  const c = { id: 'neuralops', name: 'NeuralOps', url: 'http://fixture.invalid/mcp', catalogId: 'neuralops', enabled: true, neuralopsIdentities: { alex: 'agent.alex' }, tools: ['neuralops_whoami', 'neuralops_create_task', 'neuralops_claim', 'neuralops_perform'] };
  const calls = [], state = { allow: true, version: 'orbit-v1', blocked: false, wait: null, asks: 0 }, bus = new EventEmitter();
  const gateway = { connectors: { list: () => [c], visibleTo: () => true, levelOf: () => state.blocked ? 'blocked' : 'free' }, hub: { authorize: async () => { state.asks++; return { ok: true }; } }, up: () => ({ callTool: async (name, args) => {
    calls.push({ name, args }); if (state.wait) await state.wait;
    const value = name === 'neuralops_whoami' ? { agent: { id: 'agent.alex' }, capabilities: { managedJobs: state.version } } : name === 'neuralops_create_task' ? { task: { id: args.id } } : name === 'neuralops_claim' ? { task: { id: args.taskId, assignee: 'agent.alex', status: 'in_progress' } } : { allowed: state.allow, via: 'approval' };
    return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false };
  } }) };
  const guidance = createGuidance({ home, runs, gateway });
  const tools = createTools({ home, runtime: { runs, guidance }, getCfg: () => ({}), bus, gemini: {}, ask: async () => 'once' });
  function begin(managed = true) {
    const job = home.createJob(agent.id, 'Make result.txt', { contract: { managed } }), run = runs.begin(agent.id, job.id, new AbortController().signal);
    const running = home.updateJob(agent.id, job.id, { status: 'running', runId: run.runId }); return { job: running, run };
  }
  return { home, runs, guidance, tools, c, calls, state, bus, agent, begin };
}
test('managed bootstrap records a distinct task and exact upstream worker before tools execute', async t => {
  const r = rig(t), { job, run } = r.begin(); await r.runs.within(run, async () => {
    const updated = await r.guidance.prepare(job, 'builtin'); assert.equal(updated.guidance.upstreamActor, 'agent.alex'); assert.equal(updated.guidance.runId, run.runId);
    assert.match(updated.guidance.taskId, /^task_[a-z0-9_]{1,48}$/); assert.equal(r.state.asks, 3);
    const args = { path: 'result.txt', content: 'artifact' }; assert.equal((await r.tools.exec('write_file', args, 'alex')).ok, true);
    const call = r.calls.at(-1); assert.equal(call.name, 'neuralops_perform'); assert.equal(call.args.binding.argumentsSha256, sha(stable(args))); assert.equal(call.args.binding.jobId, job.id);
    assert.equal(fs.readFileSync(r.home.p('workspace', 'alex', 'result.txt'), 'utf8'), 'artifact');
  }); r.runs.end(run);
});
test('pending NeuralOps approval blocks file writes without silently falling back', async t => {
  const r = rig(t), { job, run } = r.begin(); await r.runs.within(run, async () => { await r.guidance.prepare(job, 'builtin'); r.state.allow = false;
    assert.equal((await r.tools.exec('write_file', { path: 'result.txt', content: 'x' }, 'alex')).ok, false); assert.equal(fs.existsSync(r.home.p('workspace', 'alex', 'result.txt')), false);
  }); r.runs.end(run);
});
test('old servers and missing mappings fail before task creation', async t => {
  const r = rig(t), { job, run } = r.begin(); await r.runs.within(run, async () => {
    r.state.version = undefined; await assert.rejects(r.guidance.prepare(job, 'builtin'), /capability/); assert.equal(r.calls.length, 1);
    r.c.neuralopsIdentities = {}; await assert.rejects(r.guidance.prepare(job, 'builtin'), /identity is not configured/); assert.equal(r.calls.length, 1);
  }); r.runs.end(run);
});
test('managed Hermes/OpenCode and shell are refused until mandatory hooks and containment exist', async t => {
  const r = rig(t), { job, run } = r.begin(); await r.runs.within(run, async () => {
    for (const engine of ['hermes', 'opencode']) await assert.rejects(r.guidance.prepare(job, engine), /built-in/);
    assert.equal(r.calls.length, 0); await r.guidance.prepare(job, 'builtin');
    const count = r.calls.length; const out = await r.tools.exec('run_shell', { command: 'echo example' }, 'alex'); assert.equal(out.ok, false); assert.match(out.error, /containment/); assert.equal(r.calls.length, count);
  }); r.runs.end(run);
});
test('identity changes and blocked managed tools prevent execution', async t => {
  const r = rig(t), { job, run } = r.begin(); await r.runs.within(run, async () => {
    await r.guidance.prepare(job, 'builtin'); r.c.neuralopsIdentities.alex = 'agent.bob';
    await assert.rejects(r.guidance.guard('alex', 'builtin/read_file', {}), /identity changed/);
    r.c.neuralopsIdentities.alex = 'agent.alex'; r.state.blocked = true; await assert.rejects(r.guidance.guard('alex', 'builtin/read_file', {}), /blocked/);
  }); r.runs.end(run);
});
test('cancellation while NeuralOps responds cannot execute a delayed write', async t => {
  const r = rig(t), { job, run } = r.begin(); await r.runs.within(run, async () => {
    await r.guidance.prepare(job, 'builtin'); let finish; r.state.wait = new Promise(resolve => { finish = resolve; });
    const pending = r.tools.exec('write_file', { path: 'result.txt', content: 'x' }, 'alex');
    await new Promise(resolve => setImmediate(resolve)); r.runs.end(run); finish();
    assert.equal((await pending).ok, false); assert.equal(fs.existsSync(r.home.p('workspace', 'alex', 'result.txt')), false);
  });
});
test('missing guidance binding cannot authorize an action; ordinary jobs keep their existing mode', async t => {
  const r = rig(t), a = r.begin(); await r.runs.within(a.run, async () => {
    await assert.rejects(r.guidance.guard('alex', 'builtin/read_file', {}), /no current/);
    await assert.rejects(r.guidance.guard('commander', 'builtin/read_file', {}), /actor/);
  }); r.runs.end(a.run);
  const b = r.begin(false); await r.runs.within(b.run, async () => { await r.guidance.guard('commander', 'builtin/web_search', {}); assert.equal(r.calls.length, 0); }); r.runs.end(b.run);
});
test('worker managed execution creates a task, gates its tool and settles only to human review', async t => {
  const r = rig(t); const workers = createWorkers({ home: r.home, runs: r.runs, tools: r.tools, bus: r.bus, getCfg: () => ({ engine: 'builtin' }), getGuidance: () => r.guidance,
    gemini: { runLoop: async ({ exec }) => { const out = await exec('write_file', { path: 'result.txt', content: 'artifact' }); assert.equal(out.ok, true); return { text: 'Artifact for review.' }; } } });
  const finished = new Promise(resolve => r.bus.once('job:done', resolve)); const job = workers.dispatch('alex', 'Make result.txt', { managed: true, expectedOutputs: ['result.txt'] });
  const done = (await finished).job; assert.equal(done.id, job.id); assert.equal(done.status, 'review'); assert.equal(done.managed, true); assert.equal(done.guidance.runId, done.runId); assert.equal(r.runs.generationFor('alex'), null);
});
