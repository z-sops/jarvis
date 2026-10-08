'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { stepTimer } = require('../lib/workers');
const { makeAudit } = require('../lib/panels');

test('stepTimer: every step says how long since the last one and since the job began', () => {
  const bus = new EventEmitter(), seen = []; bus.on('job:step', e => seen.push(e));
  let t = 1000; const now = () => t;
  const mark = stepTimer(bus, { id: 'alex', name: 'Alex' }, { id: 'j1' }, now);
  t = 3500; mark('write_file');
  t = 4000; mark('');
  t = 61000; mark(undefined);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen.map(e => e.n), [1, 2, 3]);
  assert.deepEqual(seen.map(e => e.sinceLastMs), [2500, 500, 57000]);
  assert.deepEqual(seen.map(e => e.totalMs), [2500, 3000, 60000]);
  assert.equal(seen[0].what, 'write_file');
  assert.equal(seen[0].agent.name, 'Alex');
});

test('stepTimer: a broken listener never breaks the job', () => {
  const bus = new EventEmitter(); bus.on('job:step', () => { throw new Error('boom'); });
  const mark = stepTimer(bus, { id: 'a', name: 'A' }, { id: 'j' });
  assert.doesNotThrow(() => mark('x'));
});

test('the Logs tab gets one line per step, shaped like a tool line with the time it took', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steps-'));
  try {
    const bus = new EventEmitter(), home = { p: (...a) => path.join(dir, ...a) };
    const audit = makeAudit({ home, bus });
    bus.emit('job:step', { agent: { name: 'Alex' }, job: {}, n: 2, what: 'write_file', sinceLastMs: 12400, totalMs: 31000 });
    const rows = audit.tail(5), r = rows[rows.length - 1];
    assert.equal(r.name, 'step'); assert.equal(r.status, 'done'); assert.equal(r.actor, 'Alex'); assert.equal(r.ms, 12400);
    assert.match(r.detail, /#2 write_file/); assert.match(r.detail, /31\.0s/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
