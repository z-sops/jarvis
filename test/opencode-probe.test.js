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
  fs.writeFileSync(fake, "#!/usr/bin/env node\nconst a=process.argv.slice(2).join(' ');if(/Reply with exactly/.test(a)){console.log('pong');}else{setTimeout(()=>{process.stdout.write('part one ');},100);setTimeout(()=>{console.log('done');},900);}\n"); fs.chmodSync(fake, 0o755);
  const cfg = { opencodePath: fake, workerProvider: 'opencode', workerModel: 'x-free', workerApiKey: 'k', ...(extra || {}) };
  const home = { root: dir, p: (...a) => path.join(dir, ...a) };
  return new OpenCodeEngine({ home, getCfg: () => cfg });
}

test('probe: the model check answers ok with its time', { skip }, async () => {
  const r = await engine().probe(); assert.equal(r.ok, true); assert.equal(typeof r.ms, 'number');
});

test('a quiet job gets a model check, and the data counter sees every chunk', { skip }, async () => {
  const eng = engine({ opencodeProbeMs: 300 }); const labels = []; let bytes = 0;
  const out = await eng.runTask({ id: 'bob', name: 'Bob' }, 'do a long job', { onProgress: p => labels.push(p.label), onData: n => { bytes += n; } });
  assert.match(out, /part one done/); assert.ok(bytes >= 14);
  assert.ok(labels.some(l => /quiet for .*the model answers/.test(l)), labels.join(' | '));
});

test('probe says clearly when the model is not set', { skip }, async () => {
  const r = await engine({ workerModel: '' }).probe(); assert.equal(r.ok, false); assert.match(r.error, /Choose a model/);
});
