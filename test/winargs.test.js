'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { winArgs } = require('../lib/opencode');

// On Windows the arguments go through cmd.exe (shell: true). cmd.exe ENDS the command at the first line break:
// everything after it, such as "--format json", was silently dropped, and so was the end of any task with more than one line.
test('no argument keeps a line break: the lines are joined, so cmd.exe sees one line', () => {
  const out = winArgs(['run', 'first line\n\n[Orbit house rule: keep PROGRESS.md]\r\nlast', '--format', 'json', '--dir', 'G:\\x\\bob']);
  assert.equal(out[1], '"first line | [Orbit house rule: keep PROGRESS.md] | last"');
  assert.equal(out[0], 'run'); assert.equal(out[2], '--format'); assert.equal(out[3], 'json'); assert.equal(out[4], '--dir'); assert.equal(out[5], 'G:\\x\\bob');
  assert.ok(!out.some(a => /[\r\n]/.test(a)));
});

test('double quotes inside a task become single quotes; plain arguments are untouched', () => {
  const out = winArgs(['run', 'say "hello" now', '--dir', 'C:\\a']);
  assert.equal(out[1], '"say \'hello\' now"'); assert.equal(out[2], '--dir'); assert.equal(out[3], 'C:\\a');
});
