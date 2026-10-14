'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { Home } = require('../lib/home'), { createJobRuns } = require('../lib/job-runs');
const { createGuidance } = require('../lib/job-guidance'), { outcomePatch } = require('../lib/job-outcomes');
const { createWorkers } = require('../lib/workers'), { registerJobControls } = require('../lib/job-control');
function rig(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-outcomes-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = new Home(root).ensure(), agent = home.createAgent({ name: 'Alex' }), runs = createJobRuns(), calls = [], receipts = new Map();
  const c = { id: 'neuralops', name: 'NeuralOps', url: 'http://fixture.invalid', catalogId: 'neuralops', enabled: true, neuralopsIdentities: { alex: 'agent.alex' }, tools: ['neuralops_whoami', 'neuralops_create_task', 'neuralops_claim', 'neuralops_perform', 'neuralops_job_receipt', 'neuralops_job_outcome'] };
  const state = { loseResponse: false, mismatch: false, version: 'orbit-v1', blocked: false, wait: null };
  const gateway = { connectors: { list: () => [c], visibleTo: () => true, levelOf: () => state.blocked ? 'blocked' : 'free' }, hub: { authorize: async () => ({ ok: true }) }, up: () => ({ callTool: async (name, args) => {
    calls.push({ name, args }); if (state.wait) await state.wait(name);
    let value;
    if (name === 'neuralops_whoami') value = { agent: { id: 'agent.alex' }, capabilities: { managedJobs: 'orbit-v1', jobOutcomes: state.version } };
    else if (name === 'neuralops_create_task') value = { task: { id: args.id } };
    else if (name === 'neuralops_claim') value = { task: { id: args.taskId, assignee: 'agent.alex', status: 'in_progress' } };
    else if (name === 'neuralops_job_receipt') value = { receipt: state.mismatch ? { actId: args.actId, from: 'agent.bob', payload: {}, ledgerHash: 'a'.repeat(64) } : receipts.get(args.actId) || null };
    else if (name === 'neuralops_job_outcome') {
      const { actId, ...payload } = args; assert.equal(receipts.has(actId), false);
      receipts.set(actId, { actId, from: 'agent.alex', payload, ledgerHash: 'a'.repeat(64) });
      if (state.loseResponse) { state.loseResponse = false; throw new Error('Lost response after remote commit'); }
      value = { actId, task: { status: 'blocked' } };
    } else value = { allowed: true, via: 'authority' };
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  } }) };
  const guidance = createGuidance({ home, runs, gateway }), bus = new EventEmitter();
  const workers = createWorkers({ home, runs, bus, getGuidance: () => guidance, getCfg: () => ({ engine: 'builtin' }), tools: { declarationsFor: () => [], exec() {} }, gemini: { runLoop: async () => { state.onEngine?.(); if (state.engineWait) await state.engineWait; if (state.engineError) throw new Error('Fixture engine failure'); return { text: 'Fixture private report' }; } } });
  const finish = () => { const ended = new Promise(resolve => bus.once('job:done', p => resolve(p.job))); workers.dispatch(agent.id, 'Fixture task', { managed: true }); return ended; };
  return { home, runs, agent, guidance, gateway, workers, bus, finish, calls, receipts, state, c };
}
test('worker outcome and human acceptance save their queue atomically without automatic delivery or report disclosure', async t => {
  const r = rig(t), job = await r.finish(); assert.equal(job.status, 'review', job.error); assert.equal(job.remoteOutcomes.length, 1);
  assert.equal(job.remoteOutcomes[0].delivery, 'pending'); assert.equal(r.receipts.size, 0);
  const accepted = r.workers.decideReview(job.id, 'accept'); assert.equal(accepted.status, 'done'); assert.equal(accepted.remoteOutcomes.length, 2);
  assert.equal(accepted.remoteOutcomes[1].payload.state, 'accepted_locally'); assert.equal(JSON.stringify(accepted.remoteOutcomes).includes('Fixture private report'), false);
  const restored = new Home(r.home.root).findJob(job.id); assert.deepEqual(restored.remoteOutcomes, accepted.remoteOutcomes);
  const synced = await r.workers.syncOutcome(job.id); assert.equal(synced.status, 'done'); assert.equal(synced.remoteOutcomes.every(e => e.delivery === 'synced'), true); assert.equal(r.receipts.size, 2);
});
test('lost response stays unknown and fresh guidance resolves receipt without a second mutation', async t => {
  const r = rig(t), job = await r.finish(); r.state.loseResponse = true;
  await assert.rejects(r.guidance.sync(job.id), /Lost response/);
  assert.equal(r.home.findJob(job.id).remoteOutcomes[0].delivery, 'unknown'); assert.equal(r.receipts.size, 1);
  const fresh = createGuidance({ home: new Home(r.home.root), runs: createJobRuns(), gateway: r.gateway });
  assert.equal((await fresh.sync(job.id)).remoteOutcomes[0].delivery, 'synced');
  assert.equal(r.calls.filter(c => c.name === 'neuralops_job_outcome').length, 1);
});
test('parallel Sync is serialized; human rejection during delivery is retained and sent afterward', async t => {
  const r = rig(t), job = await r.finish(); let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  r.state.wait = name => name === 'neuralops_job_outcome' ? new Promise(resolve => { release = resolve; entered(); }) : Promise.resolve();
  const first = r.guidance.sync(job.id), second = r.guidance.sync(job.id); assert.equal(first, second); await waiting;
  r.workers.decideReview(job.id, 'reject'); r.state.wait = null; release();
  const done = await first; assert.equal(done.status, 'rejected'); assert.equal(done.remoteOutcomes.length, 2); assert.equal(r.receipts.size, 2);
});
test('old/blocked/identity-changed server cannot receive outcome mutations or change local acceptance', async t => {
  const r = rig(t), job = await r.finish(); r.workers.decideReview(job.id, 'accept');
  r.state.version = undefined; await assert.rejects(r.guidance.sync(job.id), /capability/);
  r.state.version = 'orbit-v1'; r.state.blocked = true; await assert.rejects(r.guidance.sync(job.id), /blocked/);
  r.state.blocked = false; r.c.neuralopsIdentities.alex = 'agent.bob'; await assert.rejects(r.guidance.sync(job.id), /identity changed/);
  assert.equal(r.receipts.size, 0); assert.equal(r.home.findJob(job.id).status, 'done');
});
test('mismatching remote receipt is never acknowledged or overwritten with a new mutation', async t => {
  const r = rig(t), job = await r.finish(); r.state.mismatch = true;
  await assert.rejects(r.guidance.sync(job.id), /exact outcome/); assert.equal(r.receipts.size, 0);
  assert.equal(r.home.findJob(job.id).remoteOutcomes[0].delivery, 'unknown');
});
test('ordinary jobs have no outcome outbox; stale managed run cannot generate one', () => {
  assert.deepEqual(outcomePatch({ managed: false }, { status: 'done' }), { status: 'done' });
  assert.throws(() => outcomePatch({ managed: true, guidance: { runId: 'old' }, runId: 'new' }, { status: 'review' }), /stale/);
});
test('startup interruption commits pending remote outcome but never contacts NeuralOps', async t => {
  const r = rig(t), job = r.home.createJob('alex', 'Interrupted managed run', { contract: { managed: true } }), run = r.runs.begin('alex', job.id, new AbortController().signal);
  r.home.updateJob('alex', job.id, { status: 'running', runId: run.runId });
  await r.runs.within(run, () => r.guidance.prepare(job, 'builtin')); r.runs.end(run);
  const count = r.calls.length, restored = new Home(r.home.root); restored.recoverJobs();
  const interrupted = restored.findJob(job.id); assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.remoteOutcomes[0].payload.state, 'interrupted'); assert.equal(r.calls.length, count);
  const synced = await r.guidance.sync(job.id); assert.equal(synced.status, 'interrupted'); assert.equal(synced.remoteOutcomes[0].delivery, 'synced');
});
test('managed engine failure and cancellation retain their distinct pending outcomes', async t => {
  const failed = rig(t); failed.state.engineError = true;
  const failure = await failed.finish(); assert.equal(failure.status, 'failed'); assert.equal(failure.remoteOutcomes[0].payload.state, 'failed');
  const stopped = rig(t); let resolveEngine, entered;
  stopped.state.engineWait = new Promise(resolve => { resolveEngine = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); stopped.state.onEngine = entered;
  const finish = stopped.finish(); await started; stopped.workers.cancel('alex'); resolveEngine();
  const cancelled = await finish; assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.remoteOutcomes[0].payload.state, 'cancelled'); assert.equal(stopped.receipts.size, 0);
});
test('only trusted UI callers can sync; async errors produce safe diagnostics', async () => {
  const handles = new Map(); let calls = 0;
  registerJobControls({ ipcMain: { handle: (name, fn) => handles.set(name, fn) }, isTrusted: e => e === 'trusted', workers: { syncOutcome: async () => { calls++; throw new Error('private upstream token'); } } });
  const fn = handles.get('jobs:sync-outcome'); assert.equal((await fn('foreign', 'id')).ok, false); assert.equal(calls, 0);
  const result = await fn('trusted', 'id'); assert.equal(calls, 1); assert.equal(result.ok, false); assert.equal(result.error.includes('token'), false);
});
