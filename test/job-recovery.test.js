'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { EventEmitter } = require('events');
const { Home } = require('../lib/home'), { createWorkers } = require('../lib/workers');
const storage = require('../lib/job-storage'), review = require('../lib/job-review');
const { registerJobControls } = require('../lib/job-control');
const { Upstream } = require('../lib/upstream');
function rig(t, runTask = async () => 'A report; review it.') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = new Home(root).ensure(), agent = home.createAgent({ name: 'Alex' }), bus = new EventEmitter();
  const workers = createWorkers({ home, bus, getCfg: () => ({ engine: 'hermes' }), hermes: { runTask }, gemini: {}, tools: {} });
  return { root, home, agent, bus, workers };
}
const running = (r, task = 'Produce proof.txt', expectedOutputs = []) => {
  const j = r.home.createJob(r.agent.id, task, { expectedOutputs });
  return r.home.updateJob(r.agent.id, j.id, { status: 'running', runId: 'old-run', startedAt: new Date().toISOString() });
};
const nextReport = r => new Promise(resolve => r.bus.once('job:done', resolve));
test('atomic records retain state and history together and reject stale generation/status updates', t => {
  const r = rig(t), j = running(r);
  assert.equal(j.revision, 2); assert.deepEqual(j.history.map(e => e.to), ['queued', 'running']);
  assert.throws(() => r.home.updateJob('alex', j.id, { status: 'done' }, { expectedRunId: 'other' }), /generation/);
  assert.throws(() => r.home.updateJob('alex', j.id, { status: 'done' }, { expectedStatus: 'queued' }), /state/);
  assert.equal(r.home.findJob(j.id).status, 'running');
  assert.throws(() => r.home.updateJob('alex', '../agent', {}), /Invalid job/);
  const updated = r.home.updateJob('alex', j.id, { id: 'evil', agent: 'other', task: 'replace goal', status: 'review' });
  assert.equal(updated.id, j.id); assert.equal(updated.agent, 'alex'); assert.equal(updated.task, j.task);
  assert.equal(fs.readdirSync(path.join(r.home.agentDir('alex'), 'jobs')).filter(n => n.endsWith('.tmp')).length, 0);
});
test('a failed atomic replacement preserves the earlier job record and removes its temporary file', t => {
  const r = rig(t), j = running(r), rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated disk failure'); };
  try { assert.throws(() => r.home.updateJob('alex', j.id, { status: 'review' }), /disk failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(r.home.findJob(j.id).status, 'running');
  assert.equal(fs.readdirSync(path.join(r.home.agentDir('alex'), 'jobs')).filter(n => n.endsWith('.tmp')).length, 0);
});
test('restart marks running/queued jobs recoverable without replaying any engine', async t => {
  let calls = 0; const r = rig(t, async () => { calls++; return 'report'; });
  const a = running(r), b = r.home.createJob('alex', 'Waiting task'), c = r.home.createJob('alex', 'Old report');
  r.home.updateJob('alex', c.id, { status: 'done' });
  const restarted = new Home(r.root).ensure(); assert.equal(restarted.recoverJobs().length, 2);
  assert.equal(restarted.findJob(a.id).status, 'interrupted'); assert.equal(restarted.findJob(b.id).status, 'queued');
  assert.equal(restarted.findJob(b.id).recoveryNeeded, true); assert.equal(restarted.findJob(c.id).status, 'done');
  assert.equal(restarted.recoverJobs().length, 0); assert.equal(calls, 0);
  await assert.rejects(r.workers.run(r.agent, restarted.findJob(b.id)), /explicit retry/);
});
test('a corrupt record blocks its worker instead of silently replaying or replacing it', t => {
  const r = rig(t), j = r.home.createJob('alex', 'Original task'), file = storage.jobFile(r.home, 'alex', j.id);
  fs.writeFileSync(file, '{broken'); r.home.recoverJobs();
  assert.throws(() => r.workers.dispatch('alex', 'another task'), /unreadable/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
test('recovery storage failure blocks the worker without crashing the application startup', t => {
  const r = rig(t), j = running(r); r.home.updateJob = () => { throw new Error('Disk unavailable'); };
  assert.doesNotThrow(() => r.home.recoverJobs()); assert.match(r.home.recoveryFaults.get('alex'), /recovery could not be saved/);
  assert.equal(r.home.findJob(j.id).status, 'running'); assert.throws(() => r.workers.dispatch('alex', 'Another'), /recovery/);
});
test('job lookup finds an older record beyond the former 200-job scan', t => {
  const r = rig(t), first = r.home.createJob('alex', 'First');
  for (let n = 0; n < 205; n++) r.home.createJob('alex', 'Later ' + n);
  assert.equal(r.home.findJob(first.id).task, 'First');
});
test('recovered queued jobs can be cancelled without dispatching them', t => {
  const r = rig(t), j = r.home.createJob('alex', 'Queued before restart'); r.home.recoverJobs();
  assert.equal(r.workers.cancel('alex'), 1); assert.equal(r.home.findJob(j.id).status, 'cancelled');
});
test('storage failure during setup never starts the engine and blocks further work without a false completion', async t => {
  let calls = 0; const r = rig(t, async () => { calls++; return 'report'; }), j = r.home.createJob('alex', 'Task');
  r.home.updateJob = () => { throw new Error('Disk unavailable'); }; let failures = 0, reports = 0;
  r.bus.on('job:storage-error', () => failures++); r.bus.on('job:done', () => reports++);
  await r.workers.run(r.agent, j);
  assert.equal(calls, 0); assert.equal(failures, 1); assert.equal(reports, 0); assert.equal(r.workers.stateOf('alex').state, 'idle');
  assert.throws(() => r.workers.dispatch('alex', 'Another'), /storage/);
});
test('legacy records are recovered and receive a revision/history without a schema rewrite', t => {
  const r = rig(t), id = 'job-legacy1';
  fs.writeFileSync(storage.jobFile(r.home, 'alex', id), JSON.stringify({ id, agent: 'alex', task: 'Legacy', status: 'running', createdAt: new Date().toISOString() }));
  r.home.recoverJobs(); assert.equal(r.home.findJob(id).status, 'interrupted'); assert.equal(r.home.findJob(id).revision, 1);
});
test('retry preserves requested outputs and context; repeated retries do not dispatch duplicates', async t => {
  let taskSeen, calls = 0; const r = rig(t, async (_, task) => { calls++; taskSeen = task; return 'I still need to produce it.'; });
  const old = running(r, 'Produce proof.txt', ['proof.txt']); r.home.recoverJobs();
  const done = nextReport(r), next = r.workers.retryJob(old.id);
  assert.throws(() => r.workers.retryJob(old.id), /Only a stopped/);
  await done;
  assert.equal(calls, 1); assert.match(taskSeen, /Inspect existing outputs first/); assert.match(taskSeen, /REQUIRED OUTPUT FILES/);
  assert.equal(next.retryOf, old.id); assert.deepEqual(next.expectedOutputs, ['proof.txt']);
  assert.equal(r.home.findJob(old.id).retryJobId, next.id); assert.equal(r.home.findJob(next.id).status, 'review');
});
test('restart reconciles a persisted retry intent and child without creating an extra job', t => {
  const r = rig(t), old = running(r); r.home.updateJob('alex', old.id, { status: 'retrying' });
  const child = r.home.createJob('alex', old.task, { retryOf: old.id }); r.home.recoverJobs();
  assert.equal(r.home.findJob(old.id).status, 'retried'); assert.equal(r.home.findJob(old.id).retryJobId, child.id);
  assert.equal(r.home.findJob(child.id).recoveryNeeded, true); assert.equal(r.home.listJobs('alex', Infinity).length, 2);
});
test('restart recovers a retry intent with no child as interrupted', t => {
  const r = rig(t), old = running(r); r.home.updateJob('alex', old.id, { status: 'retrying' }); r.home.recoverJobs();
  assert.equal(r.home.findJob(old.id).status, 'interrupted'); assert.equal(r.home.listJobs('alex').length, 1);
});
test('engine text alone produces a review-ready unverified report; human acceptance is explicit', async t => {
  const r = rig(t), done = nextReport(r), j = r.workers.dispatch('alex', 'Explain the plan'); await done;
  const record = r.home.findJob(j.id); assert.equal(record.status, 'review'); assert.equal(record.verification.status, 'unverified');
  const accepted = r.workers.decideReview(j.id, 'accept'); assert.equal(accepted.status, 'done'); assert.equal(accepted.acceptedBy, 'human');
  assert.equal(accepted.completionKind, 'human_accepted_report'); assert.equal(accepted.verification.status, 'unverified');
  assert.throws(() => r.workers.decideReview(j.id, 'accept'), /not ready/);
});
test('missing or empty requested artifacts block human acceptance even when a worker claims success', async t => {
  const r = rig(t, async () => 'Everything is done!'), done = nextReport(r), j = r.workers.dispatch('alex', 'Create proof.txt', { expectedOutputs: ['proof.txt'] }); await done;
  assert.equal(r.home.findJob(j.id).verification.status, 'failed'); assert.throws(() => r.workers.decideReview(j.id, 'accept'), /missing/);
  fs.writeFileSync(r.home.p('workspace', 'alex', 'proof.txt'), ''); assert.throws(() => r.workers.decideReview(j.id, 'accept'), /empty/);
  assert.equal(r.home.findJob(j.id).status, 'review');
});
test('requested files are fingerprinted; a later change blocks first acceptance and needs fresh inspection', async t => {
  const r = rig(t, async () => { fs.writeFileSync(r.home.p('workspace', 'alex', 'proof.txt'), 'proof'); return 'proof.txt produced'; });
  const done = nextReport(r), j = r.workers.dispatch('alex', 'Produce proof.txt', { expectedOutputs: ['proof.txt'] }); await done;
  const v = r.home.findJob(j.id).verification; assert.equal(v.status, 'files_checked'); assert.equal(v.artifacts[0].sha256.length, 64);
  fs.writeFileSync(r.home.p('workspace', 'alex', 'proof.txt'), 'changed'); assert.throws(() => r.workers.decideReview(j.id, 'accept'), /changed after/);
  assert.equal(r.home.findJob(j.id).status, 'review'); assert.equal(r.workers.decideReview(j.id, 'accept').completionKind, 'human_accepted_files');
});
test('unsafe output paths, symlinks, directories and oversized evidence are refused', t => {
  const r = rig(t); for (const p of ['../secret', '/etc/passwd', 'C:\\secret', 'sub//file', 'file\0.txt']) assert.throws(() => storage.outputs([p]), /workspace-relative/);
  fs.mkdirSync(r.home.p('workspace', 'alex', 'folder')); assert.throws(() => review.inspectOutput(r.home, 'alex', 'folder'), /regular file/);
  const outside = r.home.p('outside.txt'); fs.writeFileSync(outside, 'secret'); fs.symlinkSync(outside, r.home.p('workspace', 'alex', 'link'));
  assert.throws(() => review.inspectOutput(r.home, 'alex', 'link'), /Symbolic links/);
  fs.symlinkSync(r.root, r.home.p('workspace', 'alex', 'escape')); assert.throws(() => review.inspectOutput(r.home, 'alex', 'escape/outside.txt'), /Symbolic links/);
  const f = r.home.p('workspace', 'alex', 'big'); const fd = fs.openSync(f, 'w'); fs.ftruncateSync(fd, 8 * 1024 * 1024 + 1); fs.closeSync(fd);
  assert.throws(() => review.inspectOutput(r.home, 'alex', 'big'), /too large/);
});
test('artifact path walking preserves Windows drive roots and UNC shares', () => {
  assert.deepEqual(review.componentPaths('G:\\BridgeHome\\workspace\\alex', 'sub/proof.txt', path.win32), ['G:\\BridgeHome', 'G:\\BridgeHome\\workspace', 'G:\\BridgeHome\\workspace\\alex', 'G:\\BridgeHome\\workspace\\alex\\sub', 'G:\\BridgeHome\\workspace\\alex\\sub\\proof.txt']);
  assert.equal(review.componentPaths('\\\\host\\share\\workspace', 'proof.txt', path.win32).at(-1), '\\\\host\\share\\workspace\\proof.txt');
});
test('an empty report fails, while a secondary memory/listener failure cannot overwrite a review record', async t => {
  const r = rig(t, async () => ''), done = nextReport(r), j = r.workers.dispatch('alex', 'Anything'); await done;
  assert.equal(r.home.findJob(j.id).status, 'failed');
  const s = rig(t); s.home.appendMemory = () => { throw new Error('memory unavailable'); }; s.bus.on('job:done', () => { throw new Error('listener unavailable'); });
  const job = s.home.createJob('alex', 'Another'); await s.workers.run(s.agent, job); assert.equal(s.home.findJob(job.id).status, 'review'); assert.equal(s.workers.stateOf('alex').state, 'idle');
});
test('reject is retained separately and is not treated as accepted success', async t => {
  const r = rig(t), done = nextReport(r), j = r.workers.dispatch('alex', 'Task'); await done;
  assert.equal(r.workers.decideReview(j.id, 'reject').status, 'rejected'); assert.equal(r.home.findJob(j.id).acceptedAt, undefined);
});
test('job controls reject untrusted frames and no acceptance tool is exposed to models', () => {
  const handlers = new Map(); let invoked = 0;
  registerJobControls({ ipcMain: { handle: (n, f) => handlers.set(n, f) }, isTrusted: e => e === 'main', workers: { decideReview: () => { invoked++; return {}; }, retryJob() {}, dispatch() {} } });
  assert.equal(handlers.get('jobs:review')('subframe', 'id', 'accept').ok, false); assert.equal(invoked, 0);
  assert.equal(handlers.get('jobs:review')('main', 'id', 'accept').ok, true); assert.equal(invoked, 1);
  const decls = require('../lib/laila-tools').decls(); assert.ok(!('accept_job' in decls)); assert.ok(!('jobs:review' in decls));
});
test('remote tool failure is never automatically replayed after a dropped connection', async () => {
  const u = new Upstream({ id: 'test', url: 'http://127.0.0.1/mcp' }); let calls = 0;
  u.connect = async () => ({ callTool: async () => { calls++; u.client = null; throw new Error('ECONNRESET'); } });
  await assert.rejects(u.callTool('create_issue', {}), /outcome may be unknown/); assert.equal(calls, 1); assert.equal(u.controllers.size, 0);
});
test('stopped or expired jobs cannot invoke a remote tool after awaited connection setup', async () => {
  for (const expiry of [false, true]) {
    const u = new Upstream({ id: 'test', url: 'http://127.0.0.1/mcp' }); let release, calls = 0;
    u.connect = () => new Promise(r => { release = () => r({ callTool: () => { calls++; return {}; } }); });
    const p = u.callTool('write', {}, { assertCurrent: () => { if (expiry) throw new Error('expired run'); } }); if (!expiry) u.abort(); release();
    await assert.rejects(p, expiry ? /expired run/ : /Stopped/); assert.equal(calls, 0); assert.equal(u.controllers.size, 0);
  }
});

test('direct dispatch does not create jobs for exact control messages', t => {
  const r=rig(t);
  for(const task of ['stop','Cancel!','your job been cancelled','Your job has been canceled.'])assert.throws(()=>r.workers.dispatch(r.agent.id,task),/control message/);
  assert.equal(r.home.listJobs(r.agent.id,Infinity).length,0);
});

test('repeated retries keep one original goal and one recovery brief; broken lineage blocks creation', async t=>{
 const r=rig(t,async()=>{throw Error('Fixture failure');});let j=r.workers.dispatch(r.agent.id,'Build the full ZuniTech website');await nextReport(r);
 for(let n=0;n<3;n++){j=r.workers.retryJob(j.id);await nextReport(r);assert.equal((j.task.match(/RECOVERY:/g)||[]).length,1);assert.ok(j.task.startsWith('Build the full ZuniTech website'));}
 r.home.updateJob(r.agent.id,j.id,{retryLinkReady:false});const count=r.home.listJobs(r.agent.id,Infinity).length;
 assert.throws(()=>r.workers.retryJob(j.id),/goal lineage/);assert.equal(r.home.listJobs(r.agent.id,Infinity).length,count);
});
