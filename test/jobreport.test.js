'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jr = require('../lib/jobreport');

const job = { id: 'j1', task: 'make a site' };

test('the trail keeps steps, drops repeats, and starts fresh for a new job', () => {
  let t = 1000; const tr = jr.makeTrail(() => t);
  tr.begin('bob', job); tr.add('bob', job, { label: 'write index.html', status: 'running' }); tr.add('bob', job, { label: 'write index.html', status: 'running' }); tr.add('bob', job, { tool: 'bash' }); tr.text('bob', job, 'x'.repeat(2000));
  const s = tr.snapshot('bob', job); assert.equal(s.steps.length, 2); assert.equal(s.text.length, 1500);
  assert.equal(tr.snapshot('bob', { id: 'j2' }), null);
  tr.begin('bob', { id: 'j2', task: 't2' }); assert.equal(tr.snapshot('bob').steps.length, 0);
});

test('the report names the job, the steps, the files and the last words', () => {
  const tr = jr.makeTrail(() => 0); tr.begin('a', job); tr.add('a', job, { label: 'read file', status: 'done' }); tr.text('a', job, 'I am about to write the footer');
  const r = jr.format(tr.snapshot('a'), { name: 'Alex', files: ['site/index.html'], now: 125000 });
  assert.match(r, /Alex\*\* stopped after 2 min/); assert.match(r, /site\/index\.html/); assert.match(r, /read file \[done\]/); assert.match(r, /about to write the footer/); assert.doesNotMatch(r, /make a site/);
});

test('the saved note is short and the resume task carries only the note, not the old conversation', () => {
  const tr = jr.makeTrail(() => 0); const big = { id: 'j', task: 'T'.repeat(5000) }; tr.begin('a', big);
  for (let i = 0; i < 40; i++) tr.add('a', big, { label: 'step ' + i }); tr.text('a', big, 'y'.repeat(1500));
  const cp = jr.checkpoint(tr.snapshot('a'), { files: ['a.txt'] });
  assert.ok(cp.task.length <= 1500); assert.equal(cp.steps.length, 12); assert.ok(cp.tail.length <= 600);
  const task = jr.resumeTask(cp, 'use blue'); assert.ok(task.length < 4000); assert.match(task, /Do NOT start over/); assert.match(task, /step 39/); assert.doesNotMatch(task, /step 0\b/); assert.match(task, /use blue/);
});

test('the note is saved to disk, read back, and cleared', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-')); const cp = { task: 'x', steps: [], files: [], tail: '' };
  assert.equal(jr.load(dir, 'alex'), null); jr.save(dir, 'alex', cp); assert.deepEqual(jr.load(dir, 'alex'), cp); jr.clear(dir, 'alex'); assert.equal(jr.load(dir, 'alex'), null);
});

test('recentFiles lists only files changed since the job began', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrf-')); fs.mkdirSync(path.join(dir, 'sub'));
  const old = path.join(dir, 'old.txt'); fs.writeFileSync(old, 'o'); const past = new Date(Date.now() - 3600e3); fs.utimesSync(old, past, past);
  fs.writeFileSync(path.join(dir, 'sub', 'new.txt'), 'n');
  assert.deepEqual(jr.recentFiles(dir, Date.now() - 60e3), [path.join('sub', 'new.txt')]);
});

test('words are counted on disk and compared with the number in the job', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrw-')); fs.writeFileSync(path.join(dir, 'london.txt'), 'word '.repeat(312).trim() + '\nline two');
  const m = jr.measure(dir, ['london.txt', 'missing.txt']); assert.equal(m[0].words, 314); assert.equal(m[1].f, 'missing.txt');
  assert.deepEqual(jr.targetOf('bob-test4.txt mein 500 words mein london ki history likho'), { n: 500, unit: 'words' });
  assert.deepEqual(jr.targetOf('write 20 lines'), { n: 20, unit: 'lines' }); assert.equal(jr.targetOf('make a site'), null);
  const tr = jr.makeTrail(() => 0); const j2 = { id: 'q', task: 'london ki history 500 words' }; tr.begin('b', j2);
  const r = jr.format(tr.snapshot('b'), { name: 'Bob', files: m, now: 180000 });
  assert.match(r, /london\.txt: 314 words/); assert.match(r, /about 186 more words \(314 of 500, 63%\)/); assert.doesNotMatch(r, /london ki history/);
  const task = jr.resumeTask(jr.checkpoint(tr.snapshot('b'), { files: m }), '');
  assert.match(task, /london\.txt already has 314 words/); assert.match(task, /add about 186 more words/);
});

test('no number in the job: it says so instead of guessing; engine config is never listed', () => {
  const tr = jr.makeTrail(() => 0); tr.begin('b', job);
  assert.match(jr.format(tr.snapshot('b'), { name: 'Bob', files: [] }), /no number in it/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jro-')); fs.writeFileSync(path.join(dir, 'opencode.json'), '{}'); fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  assert.deepEqual(jr.recentFiles(dir, 0), ['a.txt']);
});

test('the meter shows bytes, speed, silence and what it means', () => {
  let n = 0; const tr = jr.makeTrail(() => n); n = 1000; tr.begin('b', job);
  assert.match(jr.meter(tr.snapshot('b'), 6000), /nothing received yet/);
  for (let i = 0; i < 11; i++) { n = 1000 + i * 1000; tr.data('b', job, 2048); }          // 22 KB in 10 s
  const live = jr.meter(tr.snapshot('b'), 12000); assert.match(live, /22\.0 KB so far/); assert.match(live, /2\.0 KB\/s/); assert.match(live, /streaming/);
  assert.match(jr.meter(tr.snapshot('b'), 50000), /quiet/); assert.match(jr.meter(tr.snapshot('b'), 200000), /stalled/);
});

test('text from Hermes counts as data too, only what is new', () => {
  let n = 0; const tr = jr.makeTrail(() => n); tr.begin('a', job); tr.text('a', job, 'hello'); tr.text('a', job, 'hello world'); assert.equal(tr.snapshot('a').bytes, 11);
});

test('PROGRESS.md gives the plan: done, still to do, and a warning when it is old', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrp-')); assert.equal(jr.readPlan(dir), null);
  fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '# Plan\n- [x] set up\n- [x] write login\n- [ ] write payment\n- [ ] run the tests\n');
  const p = jr.readPlan(dir); assert.equal(p.done, 2); assert.equal(p.total, 4); assert.deepEqual(p.todo, ['write payment', 'run the tests']);
  const tr = jr.makeTrail(() => 0); tr.begin('b', { id: 'z', task: 'build the app' });
  const r = jr.format(tr.snapshot('b'), { name: 'Bob', plan: p }); assert.match(r, /2 of 4 done/); assert.match(r, /- write payment/); assert.doesNotMatch(r, /no number in it/);
  const task = jr.resumeTask(jr.checkpoint(tr.snapshot('b'), { plan: p }), ''); assert.match(task, /2 of 4 are done/); assert.match(task, /run the tests/);
  assert.match(jr.progressNote(), /PROGRESS\.md/);
});

test('the checklist file itself is never counted as written work', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrq-')); fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '- [ ] x'); fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  assert.deepEqual(jr.recentFiles(dir, 0), ['a.txt']);
});

test('say() keeps the last words without counting them as data', () => {
  const tr = jr.makeTrail(() => 0); tr.begin('a', job); tr.say('a', job, 'I wrote the file'); const s = tr.snapshot('a'); assert.equal(s.text, 'I wrote the file'); assert.equal(s.bytes, 0);
});

test('a numbered checklist (1. [x] ...) is read as well as a bulleted one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrn-')); fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '# P\n1. [x] scan\n2. [x] plan\n3. [ ] write a.txt\n4. [ ] write b.txt\n| a | pending |\n');
  const p = jr.readPlan(dir); assert.equal(p.done, 2); assert.equal(p.total, 4); assert.deepEqual(p.todo, ['write a.txt', 'write b.txt']);
});

test('a job for several files does not claim the total from a per-file number; a to-do that names an existing file says so', () => {
  const tr = jr.makeTrail(() => 0); const j3 = { id: 'm', task: 'banao 4 files a.txt b.txt c.txt d.txt, har file mein 100 words' }; tr.begin('b', j3);
  const files = [{ f: 'a.txt', words: 107, lines: 1 }]; const plan = { done: 2, total: 4, todo: ['write a.txt', 'write b.txt'], more: 0, ageMs: 0 };
  const r = jr.format(tr.snapshot('b'), { name: 'Bob', files, plan });
  assert.match(r, /100 words per file/); assert.doesNotMatch(r, /nothing by the numbers/); assert.doesNotMatch(r, /more words/);
  assert.match(r, /- write a\.txt \u2014 file already exists \(107 words\)/); assert.match(r, /- write b\.txt\n/);
  const one = { id: 'n', task: 'write 100 words about rome' }; tr.begin('c', one); assert.match(jr.format(tr.snapshot('c'), { name: 'Bob', files }), /nothing by the numbers/);
});
