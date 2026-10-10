'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OpenCodeEngine } = require('../lib/opencode');

test('every OpenCode run of the crew gets its own data folder inside the Orbit home', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocenv-'));
  const before = process.env.XDG_DATA_HOME;
  const eng = new OpenCodeEngine({ requireContainment: false, home: { root }, getCfg: () => ({}) });
  const e = eng.env({ FOO: '1' });
  assert.equal(e.XDG_DATA_HOME, path.join(root, 'opencode', 'data'));
  assert.ok(fs.existsSync(e.XDG_DATA_HOME), 'the folder is created');
  assert.equal(e.FOO, '1');
  assert.equal(process.env.XDG_DATA_HOME, before, 'the setting is only for the child process, Orbit own environment is untouched');
});

test('a value passed in explicitly still wins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocenv-'));
  const eng = new OpenCodeEngine({ requireContainment: false, home: { root }, getCfg: () => ({}) });
  assert.equal(eng.env({ XDG_DATA_HOME: 'X' }).XDG_DATA_HOME, 'X');
});
