'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { Home } = require('../lib/home');
const { createTools } = require('../lib/tools');
const { createJobRuns } = require('../lib/job-runs');
function rig(t, ask = async () => 'once') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = new Home(path.join(root, 'home')).ensure();
  home.createAgent({ name: 'Alex' }); home.createAgent({ name: 'Bob' });
  const runs = createJobRuns();
  const tools = createTools({ home, getCfg: () => ({}), gemini: {}, bus: new EventEmitter(), ask, runtime: { runs } });
  return { root, home, tools, runs };
}
function link(t, target, destination) {
  try { fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('Symlink privilege unavailable'); return false; } throw e; }
  return true;
}
test('worker file reads cannot reach another worker, internal broker state or commander session grants', async t => {
  const { root, home, tools } = rig(t);
  fs.writeFileSync(home.p('workspace', 'alex', 'own.txt'), 'own artifact');
  fs.writeFileSync(home.p('workspace', 'bob', 'other.txt'), 'other artifact');
  assert.equal((await tools.exec('read_file', { path: 'own.txt' }, 'alex')).content, 'own artifact');
  for (const target of [home.p('workspace', 'bob', 'other.txt'), home.p('connectors', 'secrets.json'), home.p('hermes', '.bridge-secret'), home.p('jarvis', 'brain', 'soul.md')]) {
    assert.equal((await tools.exec('read_file', { path: target }, 'alex')).ok, false);
  }
  tools.grants.add('read|' + root.replace(/\\/g, '/').toLowerCase());
  assert.equal(tools.decide('read_file', { path: path.join(root, 'outside.txt') }, 'alex').level, 'deny');
});
test('secret reads and writes are blocked and secret items hidden from ordinary directory listings', async t => {
  const { home, tools } = rig(t), dir = home.p('workspace', 'alex');
  fs.writeFileSync(path.join(dir, '.env'), 'fixture only'); fs.writeFileSync(path.join(dir, 'result.txt'), 'result');
  for (const actor of ['alex', 'commander']) {
    for (const name of ['read_file', 'read_image', 'write_file']) assert.equal(tools.decide(name, { path: path.join(dir, '.env'), content: 'changed' }, actor).level, 'deny');
    for (const name of ['read_file', 'list_dir', 'write_file']) assert.equal(tools.decide(name, { path: home.p('hermes', '.bridge-secret'), content: 'changed' }, actor).level, 'deny');
  }
  assert.deepEqual((await tools.exec('list_dir', { path: '.' }, 'alex')).items.map(x => x.name), ['result.txt']);
});
test('read links and new write paths below linked directories cannot escape a worker workspace', async t => {
  const { root, home, tools } = rig(t), outside = path.join(root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'data.txt'), 'outside');
  if (!link(t, outside, home.p('workspace', 'alex', 'linked'))) return;
  for (const [tool, p] of [['read_file', 'linked/data.txt'], ['read_image', 'linked/data.txt'], ['list_dir', 'linked'], ['write_file', 'linked/new/deep.txt']]) {
    assert.equal((await tools.exec(tool, { path: p, content: 'x' }, 'alex')).ok, false);
  }
  assert.equal(fs.existsSync(path.join(outside, 'new')), false);
});
test('path replacement during a permission dialog blocks execution, even after human approval', async t => {
  let swap;
  const { root, home, tools } = rig(t, async () => { swap(); return 'once'; });
  const outside = path.join(root, 'outside'), redirected = path.join(root, 'redirected'); fs.mkdirSync(outside); fs.mkdirSync(redirected);
  const probe = home.p('workspace', 'alex', 'probe'); if (!link(t, redirected, probe)) return; fs.unlinkSync(probe);
  swap = () => { fs.rmdirSync(outside); fs.symlinkSync(redirected, outside, process.platform === 'win32' ? 'junction' : 'dir'); };
  const result = await tools.exec('write_file', { path: path.join(outside, 'file.txt'), content: 'x' });
  assert.equal(result.ok, false); assert.match(result.error, /Access changed/); assert.equal(fs.existsSync(path.join(redirected, 'file.txt')), false);
});
test('approval waits execute an immutable argument snapshot', async t => {
  const args = { path: '', content: 'original' };
  const { root, tools } = rig(t, async () => { args.content = 'changed'; return 'once'; }); args.path = path.join(root, 'approved.txt');
  assert.equal((await tools.exec('write_file', args)).ok, true); assert.equal(fs.readFileSync(args.path, 'utf8'), 'original');
});
test('a running isolated job reads its job worktree and cannot read the older shared worker workspace', async t => {
  const { root, home, tools, runs } = rig(t), worktree = path.join(root, 'isolated'); fs.mkdirSync(worktree); fs.writeFileSync(path.join(worktree, 'result.txt'), 'isolated');
  const job = home.createJob('alex', 'test'); home.updateJob('alex', job.id, { workspaceDir: worktree });
  const run = runs.begin('alex', job.id, new AbortController().signal);
  await runs.within(run, async () => {
    assert.equal((await tools.exec('read_file', { path: 'result.txt' }, 'alex')).content, 'isolated');
    assert.equal(tools.decide('list_dir', { path: home.p('workspace', 'alex') }, 'alex').level, 'deny');
  }); runs.end(run);
});
