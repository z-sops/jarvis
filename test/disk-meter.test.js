'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SysMon } = require('../lib/sysmon');
const GB = 1073741824;
const fake = table => p => { const k = Object.keys(table).find(d => String(p).toLowerCase().startsWith(d.toLowerCase())); if (!k) throw new Error('no such drive'); const t = table[k]; return { blocks: t.total, bsize: GB, bavail: t.free }; };

test('the Disk meter shows the system drive first, then the drive Orbit keeps its data on', () => {
  const m = new SysMon({ platform: 'win32', systemPath: 'C:\\', driveOf: () => 'G:\\bridge-os\\BridgeHome', statfs: fake({ 'C:': { total: 931, free: 27 }, 'G:': { total: 931, free: 471 } }) });
  const d = m.disks();
  assert.equal(d.length, 2);
  assert.deepEqual(d.map(x => x.label), ['C:', 'G:']);
  assert.deepEqual(d.map(x => x.role), ['system', 'orbit']);
  assert.equal(d[0].freeGB, 27); assert.equal(d[0].pct, 97);
  assert.equal(d[1].freeGB, 471);
});

test('when Orbit lives on the system drive there is one row, not two', () => {
  const m = new SysMon({ platform: 'win32', systemPath: 'C:\\', driveOf: () => 'c:\\Users\\EC\\BridgeHome', statfs: fake({ 'C:': { total: 500, free: 100 } }) });
  assert.equal(m.disks().length, 1);
  assert.equal(m.disks()[0].label, 'C:');
});

test('a drive that cannot be read is left out, and nothing readable gives an empty list', () => {
  const only = new SysMon({ platform: 'win32', systemPath: 'C:\\', driveOf: () => 'G:\\x', statfs: fake({ 'G:': { total: 100, free: 50 } }) });
  assert.deepEqual(only.disks().map(x => x.label), ['G:']);
  const none = new SysMon({ platform: 'win32', systemPath: 'C:\\', driveOf: () => 'G:\\x', statfs: () => { throw new Error('x'); } });
  assert.deepEqual(none.disks(), []);
});

test('the old disk() answer is unchanged, and a sample carries both', async () => {
  const m = new SysMon({ platform: 'win32', systemPath: 'C:\\', driveOf: () => 'G:\\x', statfs: fake({ 'C:': { total: 10, free: 1 }, 'G:': { total: 10, free: 9 } }), run: async () => null });
  m.gpuOff = Date.now() + 1e6;
  const s = await m.sample();
  assert.ok(Array.isArray(s.disks)); assert.ok('disk' in s);
});
