'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OpenCodeEngine } = require('../lib/opencode');

// A stand-in "opencode" that prints JSON events when it gets --format json (Unix-style script, skipped on Windows).
const skip = process.platform === 'win32';
function engine(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocjson-'));
  const fake = path.join(dir, 'fake-opencode');
  fs.writeFileSync(fake, "#!/usr/bin/env node\nif(process.argv.includes('--version')){console.log('1.2.3');process.exit(0);}const a=process.argv.slice(2);if(a.includes('--format')&&a.includes('json')){const o=x=>console.log(JSON.stringify(x));o({type:'step_start',part:{}});o({type:'text',part:{text:'All done, 3 files.'}});o({type:'step_finish',part:{tokens:{total:10,input:8,output:2}}});}else{console.log('plain text answer');}\n"); fs.chmodSync(fake, 0o755);
  const cfg = { opencodePath: fake, workerProvider: 'opencode', workerModel: 'x-free', workerApiKey: 'k', ...(extra || {}) };
  return new OpenCodeEngine({ requireContainment: false, home: { root: dir, p: (...a) => path.join(dir, ...a) }, getCfg: () => cfg });
}

test('a job reads the JSON events: the answer is the text, the steps are reported', { skip }, async () => {
  const labels = []; const texts = [];
  const out = await engine().runTask({ id: 'bob', name: 'Bob' }, 'do it', { onProgress: p => labels.push(p.label), onText: t => texts.push(t) });
  assert.equal(out, 'All done, 3 files.'); assert.ok(labels.includes('thinking')); assert.ok(labels.some(l => /step done \(8 in, 2 out\)/.test(l))); assert.deepEqual(texts, ['All done, 3 files.']);
});

test('opencodeJson: false keeps the old plain output', { skip }, async () => {
  const out = await engine({ opencodeJson: false }).runTask({ id: 'bob', name: 'Bob' }, 'do it', {});
  assert.equal(out, 'plain text answer');
});
