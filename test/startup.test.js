'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const S = require('../lib/startup');

test('start-up marks: seconds since the start, the gap to the one before, and a log file that keeps the last few starts', () => {
  S.reset(); S.mark('main.js starts', 3.2); S.mark('Electron ready', 4.05); S.mark('page loaded', 9.87); const r = S.render({ electron: '31.0.0', platform: 'win32' });
  assert.match(r, /^=== \d{4}-.*Electron 31\.0\.0 win32/); assert.match(r, /3\.20s {2}\(\+3\.20\) {2}main\.js starts/); assert.match(r, /4\.05s {2}\(\+0\.85\) {2}Electron ready/); assert.match(r, /9\.87s {2}\(\+5\.82\) {2}page loaded/, 'the big gap shows where the time went');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-')); S.flush(dir, {}); S.mark('home screen shown', 11.5); S.flush(dir, {}); const t = fs.readFileSync(path.join(dir, 'startup.log'), 'utf8');
  assert.equal((t.match(/^=== /gm) || []).length, 1, 'one block for this start, rewritten as marks are added'); assert.match(t, /home screen shown/); assert.match(t, /\[run-\d+\]/);
  for (let i = 0; i < 7; i++) { S.reset(); S.mark('start ' + i, i); S.flush(dir, {}); } const t2 = fs.readFileSync(path.join(dir, 'startup.log'), 'utf8'); assert.ok((t2.match(/^=== /gm) || []).length <= 5, 'at most 5 starts are kept'); assert.match(t2, /start 6/);
  S.reset(); assert.doesNotThrow(() => S.flush(path.join(dir, 'file.txt', 'nested'), {}), 'a log that cannot be written never stops Orbit'); assert.equal(S.mark('x'.repeat(200)).name.length, 80);
});
