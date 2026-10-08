'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { DEFAULTS } = require('../lib/store');
const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'app.js'), 'utf8');

test('the launch is quick by default and the long film is a choice (it took 18.6 seconds, which felt like Orbit was stuck)', () => {
  assert.equal(DEFAULTS.launchFilmFull, false, 'the long film is off unless you turn it on'); assert.equal(DEFAULTS.launchOnStart, true);
  assert.match(app, /const quick = !first && !cfg\.launchFilmFull;/, 'quick when it is not the very first launch and the long film is not chosen');
  assert.match(app, /for \(let n = first \? 5 : \(quick \? 3 : 4\); n >= 1 && !skipped; n--\)/, 'three short ticks instead of four long ones');
  assert.match(app, /await sleep\(quick \? 600 : 1000\)/); assert.match(app, /if \(!skipped && !quick\) \{\s*num\.classList\.add\('word'\); num\.textContent = 'Ignition';/, 'the ignition film (about 15 seconds) is only for the long film');
  assert.match(app, /chk\('launchFilmFull', 'Long launch film \(about 18 seconds\)'\)/, 'and it can be switched on in Settings');
  const ticks = 3 * 600 + 500; assert.ok(ticks < 3000, 'the quick launch is about 2.3 seconds, not 18');
});
