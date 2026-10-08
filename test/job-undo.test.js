'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../lib/jobundo');

const mk = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-')); return { root, p: (...a) => path.join(root, ...a) }; };
const write = (home, agent, f, text) => { U.before(home, agent, f); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); U.after(home, agent, f); };

test('undo puts an overwritten file back and removes a file the job created', () => {
  const home = mk(), ws = home.p('workspace', 'alex'); fs.mkdirSync(ws, { recursive: true });
  const old = path.join(ws, 'old.txt'), neu = path.join(ws, 'new.txt'); fs.writeFileSync(old, 'before');
  U.begin(home, 'alex', 'job-1', 'make files');
  write(home, 'alex', old, 'after 1'); write(home, 'alex', old, 'after 2'); write(home, 'alex', neu, 'created');
  U.end('alex');
  const prev = U.tool(home, { job_id: 'job-1' });
  assert.equal(prev.wouldDo.length, 2); assert.match(prev.next, /Nothing was changed/);
  assert.equal(fs.readFileSync(old, 'utf8'), 'after 2', 'a preview changes nothing');
  const r = U.tool(home, { job_id: 'job-1', confirm: true });
  assert.equal(r.ok, true); assert.equal(fs.readFileSync(old, 'utf8'), 'before', 'the first version comes back, not the middle one');
  assert.equal(fs.existsSync(neu), false);
  assert.equal(U.tool(home, { job_id: 'job-1', confirm: true }).ok, false, 'a second undo is refused');
});

test('a file changed after the job is left alone', () => {
  const home = mk(), ws = home.p('workspace', 'bob'); fs.mkdirSync(ws, { recursive: true });
  const f = path.join(ws, 'a.txt'); fs.writeFileSync(f, 'v0');
  U.begin(home, 'bob', 'job-2', 't'); write(home, 'bob', f, 'v1'); U.end('bob');
  fs.writeFileSync(f, 'my own later edit');
  const r = U.undo(home, 'job-2');
  assert.equal(r.skipped.length, 1); assert.match(r.skipped[0].why, /changed after the job/);
  assert.equal(fs.readFileSync(f, 'utf8'), 'my own later edit');
});

test('shell and outside engines are marked as not covered; no job running means nothing is recorded', () => {
  const home = mk(), f = path.join(home.p('workspace'), 'x.txt');
  U.before(home, 'nobody', f); assert.equal(fs.existsSync(home.p('undo')), false, 'no job running: nothing is recorded');
  U.begin(home, 'alex', 'job-3', 'run it'); U.note(home, 'alex', 'write_file'); U.note(home, 'alex', 'run_shell'); U.end('alex');
  const l = U.tool(home, {}).jobs; assert.equal(l.length, 1); assert.equal(l[0].usedShellOrExternalEngine, true); assert.equal(l[0].calls, 2);
  assert.match(U.tool(home, { job_id: 'job-3' }).notCovered, /cannot be undone/);
});

test('a file that already existed but was never written by the job is untouched; a big file is reported, not guessed', () => {
  const home = mk(), ws = home.p('workspace', 'alex'); fs.mkdirSync(ws, { recursive: true });
  const big = path.join(ws, 'big.bin'); fs.writeFileSync(big, Buffer.alloc(5 * 1024 * 1024 + 10, 1));
  U.begin(home, 'alex', 'job-4', 't'); write(home, 'alex', big, 'small'); U.before(home, 'alex', path.join(ws, 'never.txt')); U.end('alex');
  const r = U.undo(home, 'job-4');
  assert.equal(r.restored.length, 0); assert.equal(r.skipped.length, 1); assert.match(r.skipped[0].why, /too big/);
});
