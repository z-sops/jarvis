'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SysMon, parseNvidia, parseTypeperf } = require('../lib/sysmon');

test('graphics card: nvidia-smi output is read, the busiest card wins, odd output gives nothing', () => {
  const g = parseNvidia('NVIDIA GeForce RTX 3060, 41, 2150, 12288, 62\n'); assert.deepEqual(g, { name: 'NVIDIA GeForce RTX 3060', pct: 41, memUsedMB: 2150, memTotalMB: 12288, temp: 62, count: 1, source: 'nvidia-smi' });
  const two = parseNvidia('Intel thing, 3, 100, 1000, 40\nNVIDIA RTX, 88, 5000, 8192, 71\n'); assert.equal(two.name, 'NVIDIA RTX'); assert.equal(two.count, 2);
  assert.equal(parseNvidia('NVIDIA-SMI has failed because it couldn\'t communicate with the NVIDIA driver.'), null); assert.equal(parseNvidia(''), null); assert.equal(parseNvidia(null), null);
  assert.equal(parseNvidia('GPU X, [N/A], [N/A], [N/A], [N/A]').pct, null, 'a card that reports nothing is shown without numbers');
});

test('graphics card on Windows without nvidia-smi: the 3D engine load is taken from the counters (an idle desktop and a busy game)', () => {
  const head = '"(PDH-CSV 4.0)","\\\\PC\\GPU Engine(pid_1234_luid_0x00000000_0x0000A1B2_phys_0_eng_0_engtype_3D)\\Utilization Percentage","\\\\PC\\GPU Engine(pid_88_luid_0x00000000_0x0000A1B2_phys_0_eng_1_engtype_3D)\\Utilization Percentage","\\\\PC\\GPU Engine(pid_88_luid_0x00000000_0x0000A1B2_phys_0_eng_2_engtype_VideoDecode)\\Utilization Percentage","\\\\PC\\GPU Engine(pid_9_luid_0x00000000_0x0000C3D4_phys_0_eng_0_engtype_3D)\\Utilization Percentage"';
  const t = head + '\n"09/21/2026 03:45:01.123","35.5","20.25","90","2.5"\n'; const g = parseTypeperf('\n' + t); assert.equal(g.pct, 56, 'the two 3D engines of the first card add up (35.5 + 20.25); the video decoder is not counted'); assert.equal(g.source, 'windows counters');
  assert.equal(parseTypeperf('Error: Counter not found'), null); assert.equal(parseTypeperf(''), null); assert.equal(parseTypeperf(head + '\n"t","500","500","0","0"\n').pct, 100, 'never more than 100');
});

test('a sample: processor, memory, disk and Orbit\'s own use; the graphics card is asked rarely when there is none', async () => {
  const calls = []; const app = { getAppMetrics: () => [{ cpu: { percentCPUUsage: 2.5 }, memory: { workingSetSize: 204800 } }, { cpu: { percentCPUUsage: 1.25 }, memory: { workingSetSize: 102400 } }] };
  const m = new SysMon({ app, platform: 'linux', run: async (c, a) => { calls.push(c); return null; } }); const s = await m.sample();
  assert.ok(s.cpu.pct >= 0 && s.cpu.pct <= 100 && s.cpu.cores > 0); assert.ok(s.mem.totalGB > 0 && s.mem.usedGB > 0 && s.mem.pct >= 0 && s.mem.pct <= 100); assert.ok(s.disk && s.disk.totalGB > 0 && s.disk.freeGB >= 0); assert.deepEqual(s.orbit, { cpu: 3.8, memMB: 300, processes: 2 }); assert.equal(s.gpu, null);
  await m.sample(); await m.sample(); assert.equal(calls.length, 1, 'no graphics tool: asked once, then not again for a while (' + calls.length + ' calls)');
  const busy = new SysMon({ platform: 'linux', run: async () => 'NVIDIA RTX, 12, 1000, 8000, 50' }); assert.equal((await busy.sample()).gpu.pct, 12); assert.equal((await new SysMon({}).sample()).orbit, null, 'outside the app there is no Orbit figure');
  const win = new SysMon({ platform: 'win32', run: async c => (c === 'nvidia-smi' ? null : '"h","\\\\PC\\GPU Engine(pid_1_luid_0x0_0x1_phys_0_eng_0_engtype_3D)\\Utilization Percentage"\n"t","7"') }); assert.equal((await win.sample()).gpu.pct, 7, 'falls back to the Windows counters');
});

test('watching: samples arrive on a timer and stop when asked', async () => {
  const m = new SysMon({ platform: 'linux', run: async () => null }); const got = []; m.watch(s => got.push(s.t), 60); await new Promise(r => setTimeout(r, 260)); m.unwatch(); const n = got.length; assert.ok(n >= 3, 'samples: ' + n); await new Promise(r => setTimeout(r, 200)); assert.equal(got.length, n, 'no more after unwatch');
  const cpu = new SysMon({ run: async () => null }); const a = cpu.cpu(); assert.ok(a.pct >= 0 && a.pct <= 100);
});
