'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../lib/jobundo');

const mk = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'undodir-')); return { root, p: (...a) => path.join(root, ...a) }; };

test('a job by an outside engine: new, changed and deleted files in the workspace all come back', () => {
  const home = mk(), ws = home.p('workspace', 'alex'); fs.mkdirSync(path.join(ws, 'sub'), { recursive: true });
  const keep = path.join(ws, 'keep.txt'), edit = path.join(ws, 'sub', 'edit.txt'), gone = path.join(ws, 'gone.txt'), fresh = path.join(ws, 'fresh.txt');
  fs.writeFileSync(keep, 'same'); fs.writeFileSync(edit, 'v0'); fs.writeFileSync(gone, 'precious');
  U.begin(home, 'alex', 'job-d1', 'hermes job'); U.note(home, 'alex', 'external_engine'); U.snapDir(home, 'alex', ws);
  fs.writeFileSync(edit, 'v1 changed by hermes'); fs.unlinkSync(gone); fs.writeFileSync(fresh, 'new file');   // what the engine did
  U.diffDir(home, 'alex'); U.end('alex');
  const prev = U.tool(home, { job_id: 'job-d1' });
  assert.deepEqual(prev.wouldDo.map(x => x.action).sort(), ['remove', 'restore', 'restore']);
  assert.ok(prev.wouldDo.every(x => x.path !== keep), 'an unchanged file is not in the plan');
  const r = U.tool(home, { job_id: 'job-d1', confirm: true });
  assert.equal(r.restored.length, 2); assert.equal(r.removed.length, 1);
  assert.equal(fs.readFileSync(edit, 'utf8'), 'v0'); assert.equal(fs.readFileSync(gone, 'utf8'), 'precious'); assert.equal(fs.existsSync(fresh), false); assert.equal(fs.readFileSync(keep, 'utf8'), 'same');
});

test('the list of recent jobs counts the files, and a later edit by the user is left alone', () => {
  const home = mk(), ws = home.p('workspace', 'alex'); fs.mkdirSync(ws, { recursive: true });
  const f = path.join(ws, 'a.txt'); fs.writeFileSync(f, 'v0');
  U.begin(home, 'alex', 'job-d2', 't'); U.snapDir(home, 'alex', ws); fs.writeFileSync(f, 'v1'); fs.writeFileSync(path.join(ws, 'b.txt'), 'x'); U.diffDir(home, 'alex'); U.end('alex');
  assert.equal(U.tool(home, {}).jobs[0].files, 2);
  fs.writeFileSync(f, 'my edit afterwards');
  const r = U.undo(home, 'job-d2');
  assert.equal(r.skipped.length, 1); assert.equal(fs.readFileSync(f, 'utf8'), 'my edit afterwards'); assert.equal(r.removed.length, 1);
});

test('node_modules and .git are not copied, and a missing workspace is not an error', () => {
  const home = mk(), ws = home.p('workspace', 'bob'); fs.mkdirSync(path.join(ws, 'node_modules'), { recursive: true }); fs.writeFileSync(path.join(ws, 'node_modules', 'x.js'), '1');
  U.begin(home, 'bob', 'job-d3', 't'); U.snapDir(home, 'bob', ws); fs.writeFileSync(path.join(ws, 'node_modules', 'x.js'), '2'); U.diffDir(home, 'bob'); U.end('bob');
  assert.equal(U.tool(home, { job_id: 'job-d3' }).wouldDo.length, 0);
  U.begin(home, 'bob', 'job-d4', 't'); U.snapDir(home, 'bob', home.p('workspace', 'nowhere')); U.diffDir(home, 'bob'); U.end('bob');
  assert.equal(U.tool(home, { job_id: 'job-d4' }).wouldDo.length, 0);
});

test('a file changed to the same size within the same instant is still seen (timestamps cannot be trusted)', () => {
  const home = mk(), ws = home.p('workspace', 'alex'); fs.mkdirSync(ws, { recursive: true });
  const f = path.join(ws, 'a.txt'); fs.writeFileSync(f, 'v0'); const st = fs.statSync(f);
  U.begin(home, 'alex', 'job-d5', 't'); U.snapDir(home, 'alex', ws);
  fs.writeFileSync(f, 'v1'); fs.utimesSync(f, st.atime, st.mtime);   // same size, same modified time
  U.diffDir(home, 'alex'); U.end('alex');
  assert.equal(U.tool(home, { job_id: 'job-d5' }).wouldDo.length, 1);
  U.undo(home, 'job-d5'); assert.equal(fs.readFileSync(f, 'utf8'), 'v0');
});
