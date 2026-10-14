'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OpenCodeEngine } = require('../lib/opencode');

// A stand-in "opencode" (needs a Unix-style executable script, so it is skipped on Windows).
// "Reply with exactly ..." is the model check and answers pong at once; a real job stays quiet for a while, then answers.
const skip = process.platform === 'win32';
function engine(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocprobe-'));
  const fake = path.join(dir, 'fake-opencode');
  fs.writeFileSync(fake, "#!/usr/bin/env node\nif(process.argv.includes('--version')){console.log('1.2.3');process.exit(0);}const a=process.argv.slice(2).join(' ');if(/Reply with exactly/.test(a)){console.log('pong');}else{setTimeout(()=>{process.stdout.write('part one ');},100);setTimeout(()=>{console.log('done');},900);}\n"); fs.chmodSync(fake, 0o755);
  const cfg = { opencodePath: fake, workerProvider: 'opencode', workerModel: 'x-free', workerApiKey: 'k', ...(extra || {}) };
  const home = { root: dir, p: (...a) => path.join(dir, ...a) };
  return new OpenCodeEngine({ requireContainment: false, home, getCfg: () => cfg });
}

test('probe: the model check answers ok with its time', { skip }, async () => {
  const r = await engine().probe(); assert.equal(r.ok, true); assert.equal(typeof r.ms, 'number');
});

test('a quiet job reports unknown state without a paid model probe, and counts every chunk', { skip }, async () => {
  const eng = engine({ opencodeProbeMs: 300 }); const labels = []; let bytes = 0, probes = 0;
  eng.probe = async () => { probes++; throw Error('Unexpected model probe'); };
  const out = await eng.runTask({ id: 'bob', name: 'Bob' }, 'do a long job', { onProgress: p => labels.push(p.label), onData: n => { bytes += n; } });
  assert.match(out, /part one done/); assert.ok(bytes >= 14);
  assert.ok(labels.some(l => /worker state is unknown.*No paid model probe/.test(l)), labels.join(' | ')); assert.equal(probes, 0);
});

test('probe says clearly when the model is not set', { skip }, async () => {
  const r = await engine({ workerModel: '' }).probe(); assert.equal(r.ok, false); assert.match(r.error, /Choose a model/);
});
