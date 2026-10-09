'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process'), { EventEmitter } = require('events');
const { Home } = require('../lib/home'), { Library } = require('../lib/library'), contracts = require('../lib/job-contract');
const { createWorkers } = require('../lib/workers');
function rig(t, engine = async () => 'Review this report.') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-contract-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = new Home(path.join(root, 'home')).ensure(), agent = home.createAgent({ name: 'Alex', role: 'Developer' }), bus = new EventEmitter();
  const workers = createWorkers({ home, bus, getCfg: () => ({ engine: 'hermes' }), hermes: { runTask: engine }, tools: {}, gemini: {} });
  return { root, home, agent, bus, workers };
}
const settled = r => new Promise(resolve => r.bus.once('job:done', resolve));
test('job skill selection is bounded, relevant and persisted without granting tool permissions', t => {
  const r = rig(t), lib = new Library(r.home);
  lib.saveSkill({ name: 'React testing', description: 'React component testing', body: 'Check accessible buttons and component behavior.' });
  lib.saveSkill({ name: 'Payroll', description: 'Salary accounting', body: 'Check payroll.' });
  lib.setAssignment('alex', { skills: ['react-testing'] });
  const c = contracts.build(r.home, r.agent, 'Perform React component testing');
  assert.deepEqual(c.selectedSkills.map(s => s.slug), ['react-testing']); assert.equal(c.selectedSkills[0].selectedBy, 'keyword_match');
  assert.deepEqual(c.context.approvalRefs, []); assert.deepEqual(lib.assignmentFor('alex').skills, ['react-testing']);
  const j = r.home.createJob('alex', 'React testing', { contract: c }); assert.match(contracts.prompt(r.home, j), /accessible buttons/);
  lib.saveSkill({ name: 'React testing', body: 'Changed instructions' }); assert.throws(() => contracts.prompt(r.home, j), /changed/);
});
test('unknown dependencies and invalid skill/project specifications fail before dispatch', t => {
  const r = rig(t); assert.throws(() => r.workers.dispatch('alex', 'Test', { dependencies: ['job-missing'] }), /existing job/);
  assert.throws(() => r.workers.dispatch('alex', 'Test', { skills: ['missing'] }), /not given/);
  assert.throws(() => r.workers.dispatch('alex', 'Test', { projectRoot: '../repo' }), /absolute/);
  assert.equal(r.home.listJobs('alex', 99).length, 0);
});
test('a dependency report does not start the tester until a human accepts it', async t => {
  const calls = [], r = rig(t, async (agent, task) => { calls.push(agent.id); return 'Report for human review'; }); r.home.createAgent({ name: 'Bob' });
  const aDone = settled(r), parent = r.workers.dispatch('alex', 'Build'); await aDone;
  const child = r.workers.dispatch('bob', 'Test accepted build', { dependencies: [parent.id] });
  await new Promise(resolve => setTimeout(resolve, 240)); assert.deepEqual(calls, ['alex']);
  const bDone = settled(r); r.workers.decideReview(parent.id, 'accept'); await bDone;
  assert.deepEqual(calls, ['alex', 'bob']); assert.equal(r.home.findJob(child.id).status, 'review');
});
test('rejected prerequisites fail dependent work without an engine call', async t => {
  let calls = 0; const r = rig(t, async () => { calls++; return 'report'; }); r.home.createAgent({ name: 'Bob' });
  const aDone = settled(r), parent = r.workers.dispatch('alex', 'Build'); await aDone; r.workers.decideReview(parent.id, 'reject');
  const bDone = settled(r), child = r.workers.dispatch('bob', 'Test', { dependencies: [parent.id] }); await bDone;
  assert.equal(calls, 1); assert.equal(r.home.findJob(child.id).status, 'failed');
});
test('Stop cancels a dependency wait without running its engine', async t => {
  const r = rig(t), parent = r.home.createJob('alex', 'Pending'); r.home.createAgent({ name: 'Bob' });
  const child = r.workers.dispatch('bob', 'Wait', { dependencies: [parent.id] }); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(r.workers.cancel('bob'), 1); await new Promise(resolve => setTimeout(resolve, 240)); assert.equal(r.home.findJob(child.id).status, 'cancelled');
});
function repo(r) {
  const dir = path.join(r.root, 'project'); fs.mkdirSync(dir); const git = args => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init']); fs.writeFileSync(path.join(dir, 'source.txt'), 'original'); git(['add', 'source.txt']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture']); return { dir, git };
}
test('parallel coding jobs get separate real Git worktrees and do not change the source checkout', async t => {
  const r = rig(t, async (_agent, _task, opts) => { fs.writeFileSync(path.join(opts.cfgOverride.workspaceDir, 'source.txt'), _agent.id); return 'Edited isolated source.txt'; });
  const p = repo(r); r.home.createAgent({ name: 'Bob' });
  const a = r.workers.dispatch('alex', 'Edit', { projectRoot: p.dir, expectedOutputs: ['source.txt'] });
  const b = r.workers.dispatch('bob', 'Edit', { projectRoot: p.dir, expectedOutputs: ['source.txt'] });
  while ([a, b].some(j => r.home.findJob(j.id).status !== 'review')) await new Promise(resolve => setTimeout(resolve, 20));
  const ja = r.home.findJob(a.id), jb = r.home.findJob(b.id); assert.notEqual(ja.workspaceDir, jb.workspaceDir);
  assert.equal(fs.readFileSync(path.join(p.dir, 'source.txt'), 'utf8'), 'original'); assert.equal(ja.verification.status, 'files_checked');
  assert.equal(fs.readFileSync(path.join(ja.workspaceDir, 'source.txt'), 'utf8'), 'alex'); assert.equal(fs.readFileSync(path.join(jb.workspaceDir, 'source.txt'), 'utf8'), 'bob');
  assert.equal(p.git(['status', '--porcelain']).trim(), '');
});
test('dirty source checkout is preserved and rejected before engine execution', async t => {
  let calls = 0; const r = rig(t, async () => { calls++; return 'report'; }), p = repo(r); fs.writeFileSync(path.join(p.dir, 'source.txt'), 'unsaved edits');
  const done = settled(r), j = r.workers.dispatch('alex', 'Edit', { projectRoot: p.dir }); await done;
  assert.equal(calls, 0); assert.equal(r.home.findJob(j.id).status, 'failed'); assert.match(r.home.findJob(j.id).error, /uncommitted/);
  assert.equal(fs.readFileSync(path.join(p.dir, 'source.txt'), 'utf8'), 'unsaved edits');
});
test('accepted artifacts are copied with evidence into a unique structured handoff', async t => {
  const r = rig(t); r.home.createAgent({ name: 'Bob' }); fs.writeFileSync(r.home.p('workspace', 'alex', 'proof.txt'), 'accepted artifact');
  const parent = r.home.createJob('alex', 'Build', { expectedOutputs: ['proof.txt'] });
  r.home.updateJob('alex', parent.id, { status: 'review', result: 'Worker report' }); r.workers.decideReview(parent.id, 'accept');
  const child = r.home.createJob('bob', 'Test', { contract: { dependencies: [parent.id] } });
  const handoff = contracts.prepareHandoffs(r.home, 'bob', child)[0]; assert.equal(handoff.actor, 'alex'); assert.equal(handoff.verification, 'files_checked');
  assert.equal(fs.readFileSync(r.home.p('workspace', 'bob', handoff.artifacts[0].path), 'utf8'), 'accepted artifact');
  fs.writeFileSync(r.home.p('workspace', 'alex', 'proof.txt'), 'changed after acceptance');
  const other = r.home.createJob('bob', 'Retest', { contract: { dependencies: [parent.id] } }); assert.throws(() => contracts.prepareHandoffs(r.home, 'bob', other), /changed/);
});
test('handoff destination links and secret artifacts are refused before copying', t => {
  const r = rig(t); r.home.createAgent({ name: 'Bob' }); const review = require('../lib/job-review');
  fs.writeFileSync(r.home.p('workspace', 'alex', 'proof.txt'), 'accepted artifact');
  const parent = r.home.createJob('alex', 'Build', { expectedOutputs: ['proof.txt'] }); r.home.updateJob('alex', parent.id, { status: 'review', result: 'Report' }); r.workers.decideReview(parent.id, 'accept');
  const child = r.home.createJob('bob', 'Test', { contract: { dependencies: [parent.id] } }), outside = path.join(r.root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, r.home.p('workspace', 'bob', '.handoffs'), 'junction'); assert.throws(() => contracts.prepareHandoffs(r.home, 'bob', child), /symbolic link/); assert.deepEqual(fs.readdirSync(outside), []);
  fs.writeFileSync(r.home.p('workspace', 'alex', '.env'), 'fixture-only'); r.home.updateJob('alex', parent.id, { verification: { artifacts: [{ path: '.env', ...review.inspectOutput(r.home, 'alex', '.env') }] } });
  assert.throws(() => contracts.prepareHandoffs(r.home, 'bob', child), /Secret files/);
});

test('project acceptance fingerprints unlisted code, deletions and new files, not only requested artifacts', async t => {
  const r=rig(t,async(_a,_task,o)=>{fs.writeFileSync(path.join(o.cfgOverride.workspaceDir,'proof.txt'),'artifact');return 'Review changes';}),p=repo(r);
  const done=settled(r),j=r.workers.dispatch('alex','Build',{projectRoot:p.dir,expectedOutputs:['proof.txt']});await done;
  const saved=r.home.findJob(j.id),review=require('../lib/job-review');assert.ok(saved.verification.revision.sha256);assert.equal(saved.verification.revision.files,2);
  fs.writeFileSync(path.join(saved.workspaceDir,'source.txt'),'changed after report');
  assert.throws(()=>r.workers.decideReview(j.id,'accept'),/project revision changed/);assert.equal(r.home.findJob(j.id).status,'review');
  // The blocked attempt records a fresh fingerprint for an explicit second human review.
  fs.writeFileSync(path.join(saved.workspaceDir,'extra.txt'),'new unlisted code');assert.throws(()=>r.workers.decideReview(j.id,'accept'),/project revision changed/);
  fs.unlinkSync(path.join(saved.workspaceDir,'source.txt'));assert.throws(()=>r.workers.decideReview(j.id,'accept'),/project revision changed/);
  const now=r.home.findJob(j.id);assert.notEqual(now.verification.revision.sha256,saved.verification.revision.sha256);
  assert.throws(()=>r.workers.decideReview(j.id,'accept'),/QA gate/);
  assert.equal(review.revisionEvidence(r.home,'alex',saved).sha256,now.verification.revision.sha256);
});
test('project fingerprint accepts empty source files, excludes ignored data explicitly and fails on links', t => {
  const r=rig(t),p=repo(r),review=require('../lib/job-review');fs.writeFileSync(path.join(p.dir,'empty.txt'),'');fs.writeFileSync(path.join(p.dir,'.gitignore'),'ignored.txt\n');
  const job={workspaceDir:p.dir,isolation:'git_worktree'};const before=review.revisionEvidence(r.home,'alex',job);fs.writeFileSync(path.join(p.dir,'ignored.txt'),'excluded runtime data');assert.equal(review.revisionEvidence(r.home,'alex',job).sha256,before.sha256);
  fs.symlinkSync(path.join(p.dir,'source.txt'),path.join(p.dir,'link.txt'));assert.throws(()=>review.revisionEvidence(r.home,'alex',job),/Symbolic links/);
});
