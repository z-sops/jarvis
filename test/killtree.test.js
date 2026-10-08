'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { wrap } = require('../lib/killtree');

const fake = pid => { const p = new EventEmitter(); p.pid = pid; p.killed = 0; p.kill = () => { p.killed++; return true; }; return p; };
const wait = ms => new Promise(r => setTimeout(r, ms));

test('on Windows the whole tree is ended FIRST; the plain kill comes only after that has finished', async () => {
  const calls = []; const p = fake(4242);
  wrap(p, { platform: 'win32', run: pid => { calls.push(pid); return wait(60); } });
  assert.equal(p.kill(), true);
  await wait(10); assert.deepEqual(calls, [4242]); assert.equal(p.killed, 0, 'cmd.exe must not be killed before taskkill has walked the tree');
  await wait(120); assert.equal(p.killed, 1);
});

test('asking twice ends the tree once', async () => {
  const calls = []; const p = fake(5); wrap(p, { platform: 'win32', run: pid => { calls.push(pid); return wait(5); } });
  p.kill(); p.kill(); await wait(60); assert.deepEqual(calls, [5]); assert.equal(p.killed, 1);
});

test('a tree kill that fails or hangs never prevents the normal kill', async () => {
  const a = fake(9); wrap(a, { platform: 'win32', run: () => { throw new Error('no taskkill'); } }); a.kill(); await wait(30); assert.equal(a.killed, 1);
  const b = fake(10); wrap(b, { platform: 'win32', waitMs: 40, run: () => new Promise(() => {}) }); b.kill(); await wait(120); assert.equal(b.killed, 1);
});

test('every step is logged; no pid means a plain kill at once; other systems are untouched', async () => {
  const lines = []; const p = fake(7); wrap(p, { platform: 'win32', log: m => lines.push(m), run: () => Promise.resolve() }); p.kill(); await wait(30); assert.match(lines.join('|'), /stop asked for pid 7/);
  const q = fake(undefined); wrap(q, { platform: 'win32', run: () => assert.fail('no pid') }); q.kill(); assert.equal(q.killed, 1);
  const l = fake(3); const before = l.kill; wrap(l, { platform: 'linux' }); assert.equal(l.kill, before);
});
