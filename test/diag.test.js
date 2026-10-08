'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter } = require('events');
const diag = require('../lib/diag');

test('the exit log records why Orbit closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-diag-')); const app = new EventEmitter();
  diag.install({ app, getDir: () => path.join(dir, 'logs') });
  diag.note('the X button in the Orbit window was pressed (win:quit)');
  app.emit('before-quit'); app.emit('will-quit'); app.emit('quit', {}, 0); app.emit('second-instance');
  app.emit('render-process-gone', {}, {}, { reason: 'crashed', exitCode: 5 }); app.emit('child-process-gone', {}, { type: 'GPU', reason: 'killed', exitCode: 9 });
  const win = new EventEmitter(); app.emit('browser-window-created', {}, win); win.emit('close'); win.emit('hide'); win.emit('unresponsive'); win.emit('session-end');
  const log = fs.readFileSync(path.join(dir, 'logs', 'bridge-main.log'), 'utf8');
  for (const s of ['START pid', 'the X button', 'before-quit: Orbit is closing on purpose', 'quit event, exit code 0', 'another Orbit was started', 'WINDOW PROCESS GONE: crashed', 'HELPER PROCESS GONE: GPU', 'window: close requested', 'window hidden', 'WINDOW NOT RESPONDING', 'WINDOWS is ending the session']) assert.ok(log.includes(s), 'log has: ' + s);
});

test('the exit log never throws, even with an unusable folder', () => {
  assert.doesNotThrow(() => diag.install({ app: new EventEmitter(), getDir: () => { throw new Error('no folder'); } }));
});
