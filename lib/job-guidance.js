'use strict';
// Optional managed jobs. The private broker supplies identity and recorded run
// state; model arguments never select the job, upstream actor or approval.
const crypto = require('node:crypto');
const { identityFor } = require('./neuralops-identity');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}
function response(r) {
  if (!r || r.isError) throw new Error('NeuralOps rejected the managed operation. Inspect its approval/task record.');
  const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let value; try { value = JSON.parse(text); } catch { throw new Error('NeuralOps returned an invalid managed response.'); }
  if (!value || typeof value !== 'object') throw new Error('NeuralOps returned an invalid managed response.');
  return value;
}
function createGuidance({ home, runs, gateway }) {
  const syncing = new Map();
  function connector(actor, binding) {
    const visible = gateway.connectors.list().filter(c => c.enabled && c.catalogId === 'neuralops' && gateway.connectors.visibleTo(c, actor));
    if (visible.length !== 1) throw new Error('Managed jobs require exactly one enabled NeuralOps connector visible to this worker.');
    const c = visible[0], upstreamActor = identityFor(c, actor);
    if (binding && (binding.connectorId !== c.id || binding.upstreamActor !== upstreamActor || binding.url !== c.url)) throw new Error('Managed connector or worker identity changed. Start a new job after review.');
    return { c, upstreamActor };
  }
  async function call(run, c, name, args) {
    runs.assert(run);
    const expectedIdentity = identityFor(c, run.actor), expectedUrl = c.url, expectedLevel = gateway.connectors.levelOf(c.id, name);
    if (!(c.tools || []).includes(name) || gateway.connectors.levelOf(c.id, name) === 'blocked') throw new Error('Required NeuralOps managed operation is unavailable or blocked: ' + name);
    const auth = await gateway.hub.authorize({ actor: run.actor, source: c.name, sourceId: c.id, tool: name, level: gateway.connectors.levelOf(c.id, name), args });
    runs.assert(run);
    if (!auth.ok) throw new Error('The user declined the NeuralOps managed operation.');
    const fresh = connector(run.actor);
    if (fresh.c.id !== c.id || fresh.c.url !== expectedUrl || fresh.upstreamActor !== expectedIdentity || gateway.connectors.levelOf(c.id, name) !== expectedLevel) throw new Error('NeuralOps access changed while awaiting approval.');
    // Internal bootstrap/perform only. No model-selected administrative calls.
    const out = await gateway.up(c, run.actor).callTool(name, args, { actor: run.actor, assertCurrent: () => runs.assert(run) });
    runs.assert(run); return response(out);
  }
  async function prepare(job, engine) {
    if (!job.managed) return job;
    if (engine && engine !== 'builtin') throw new Error('Managed jobs currently support only the built-in engine. Direct Hermes/OpenCode tools do not yet have verified mandatory hooks.');
    const run = runs.assert(runs.current()), { c, upstreamActor } = connector(run.actor);
    const me = await call(run, c, 'neuralops_whoami', {});
    if (me.agent?.id !== upstreamActor || me.capabilities?.managedJobs !== 'orbit-v1') throw new Error('NeuralOps identity or managedJobs orbit-v1 capability is missing. Update the server before using managed jobs.');
    const taskId = 'task_' + job.id.slice(4).replace(/-/g, '_') + '_' + run.runId.replace(/-/g, '').slice(0, 10);
    const created = await call(run, c, 'neuralops_create_task', { id: taskId, title: job.task.slice(0, 200), objective: job.task.slice(0, 4000), constraints: ['orbit.job:' + job.id, 'orbit.run:' + run.runId] });
    if (created.task?.id !== taskId) throw new Error('NeuralOps did not return the created managed task. Outcome uncertain; inspect before retrying.');
    const claimed = await call(run, c, 'neuralops_claim', { taskId });
    if (claimed.task?.id !== taskId || claimed.task.assignee !== upstreamActor || claimed.task.status !== 'in_progress') throw new Error('NeuralOps did not confirm managed task ownership.');
    connector(run.actor, { connectorId: c.id, upstreamActor, url: c.url });
    return home.updateJob(run.actor, job.id, { guidance: { version: 'orbit-v1', connectorId: c.id, upstreamActor, url: c.url, taskId, runId: run.runId } }, { expectedStatus: 'running', expectedRunId: run.runId });
  }
  async function guard(actor, tool, args) {
    const run = runs.current(); if (!run) return;
    runs.assert(run);
    const job = home.findJob(run.jobId); if (!job?.managed) return;
    if (run.actor !== actor) throw new Error('Tool actor does not match the active job.');
    if (tool === 'builtin/run_shell') throw new Error('Managed shell is unavailable until host containment is verified.');
    const binding = job.guidance;
    if (!binding || binding.runId !== run.runId) throw new Error('Managed job has no current NeuralOps task binding.');
    const { c } = connector(actor, binding), argumentsSha256 = sha(stable(args));
    const approved = await call(run, c, 'neuralops_perform', { taskId: binding.taskId, action: 'tool.' + sha(tool).slice(0, 32), scope: 'orbit:' + job.id, target: tool, binding: { version: 'orbit-v1', jobId: job.id, runId: run.runId, tool, argumentsSha256 } });
    connector(actor, binding);
    if (approved.allowed !== true || !['authority', 'approval'].includes(approved.via)) throw new Error('NeuralOps has not authorized this exact managed action. Inspect its approval record; do not bypass it.');
  }
  // Explicit UI reconciliation only: no startup/background replay. Fixed act
  // IDs and durable receipts resolve a response lost after remote commit.
  function sync(jobId) {
    if (syncing.has(jobId)) return syncing.get(jobId);
    const promise = syncOutcomes(jobId).finally(() => syncing.delete(jobId));
    syncing.set(jobId, promise); return promise;
  }
  async function syncOutcomes(jobId) {
    const initial = home.findJob(jobId), binding = initial?.guidance;
    if (!initial?.managed || !binding || !initial.remoteOutcomes?.length) throw new Error('This job has no recorded managed outcome to sync.');
    const actor = initial.agent;
    function current() {
      const job = home.findJob(jobId);
      if (!job || job.agent !== actor || job.runId !== binding.runId || stable(job.guidance) !== stable(binding)) throw new Error('Managed outcome binding changed. Inspect before syncing.');
      connector(actor, binding); return job;
    }
    async function send(name, args) {
      current(); const { c } = connector(actor, binding), level = gateway.connectors.levelOf(c.id, name);
      if (!(c.tools || []).includes(name) || level === 'blocked') throw new Error('Required NeuralOps outcome operation is unavailable or blocked: ' + name);
      const auth = await gateway.hub.authorize({ actor, source: c.name, sourceId: c.id, tool: name, level, args });
      current(); if (!auth.ok) throw new Error('The user declined the NeuralOps outcome operation.');
      if (gateway.connectors.levelOf(c.id, name) !== level) throw new Error('NeuralOps access changed while awaiting approval.');
      const value = response(await gateway.up(c, actor).callTool(name, args, { actor, assertCurrent: current }));
      current(); return value;
    }
    function mark(entry, patch) {
      const job = current();
      const remoteOutcomes = job.remoteOutcomes.map(e => e.actId === entry.actId ? { ...e, ...patch } : e);
      return home.updateJob(actor, jobId, { remoteOutcomes }, { expectedRunId: binding.runId, event: 'remote_outcome_' + patch.delivery });
    }
    const me = await send('neuralops_whoami', {});
    if (me.agent?.id !== binding.upstreamActor || me.capabilities?.jobOutcomes !== 'orbit-v1') throw new Error('NeuralOps outcome identity or jobOutcomes orbit-v1 capability is missing.');
    for (;;) {
      const entry = current().remoteOutcomes.find(e => e.delivery !== 'synced'); if (!entry) break;
      try {
        const lookup = () => send('neuralops_job_receipt', { taskId: binding.taskId, actId: entry.actId });
        let { receipt } = await lookup();
        if (!receipt) {
          mark(entry, { delivery: 'unknown', lastAttemptAt: new Date().toISOString() });
          await send('neuralops_job_outcome', { ...entry.payload, actId: entry.actId });
          ({ receipt } = await lookup());
        }
        if (!receipt || receipt.actId !== entry.actId || receipt.from !== binding.upstreamActor || stable(receipt.payload) !== stable(entry.payload) || !/^[a-f0-9]{64}$/.test(receipt.ledgerHash || '')) throw new Error('The remote receipt does not confirm this exact outcome.');
        mark(entry, { delivery: 'synced', ledgerHash: receipt.ledgerHash, syncedAt: new Date().toISOString(), error: null });
      } catch (e) {
        mark(entry, { delivery: 'unknown', error: 'Remote outcome was not confirmed. Inspect NeuralOps, then explicitly Sync again.' });
        throw e;
      }
    }
    return current();
  }
  return { prepare, guard, sync };
}
module.exports = { createGuidance, stable, sha };
