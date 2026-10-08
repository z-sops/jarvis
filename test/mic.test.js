'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const vm = require('vm');

// live.js is a browser script: load it in a sandbox and test its pure helpers.
const win = {}; const ctx = vm.createContext({ window: win, console, atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64') });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'live.js'), 'utf8'), ctx);
const { timeNote, dbLevel } = win.LiveClient;

test('the greeting carries the real time of day from the computer clock', () => {
  const at = (h, m = 0) => timeNote(new Date(2026, 8, 20, h, m));
  assert.match(at(9), /It is morning/); assert.match(at(11, 59), /It is morning/);
  assert.match(at(12), /It is afternoon/); assert.match(at(15, 4), /It is afternoon/); assert.match(at(16, 59), /It is afternoon/);
  assert.match(at(17), /It is evening/); assert.match(at(20, 59), /It is evening/);
  assert.match(at(21), /It is night/); assert.match(at(2), /It is night/); assert.match(at(4, 59), /It is night/);
  assert.match(at(15, 4), /3:04 pm|3:04 PM/i); assert.match(at(15, 4), /Sunday, 20 September 2026/);
  assert.match(at(15), /never say "good morning" unless it is morning/);
});

test('the mic meter: silence is empty, quiet speech is visible, loud speech is nearly full, and it never goes out of range', () => {
  assert.equal(dbLevel(0), 0); assert.equal(dbLevel(1e-6), 0);
  const quiet = dbLevel(0.0056), talk = dbLevel(0.03), loud = dbLevel(0.18), max = dbLevel(1);   // about -45, -30, -15 and 0 dBFS
  assert.ok(quiet > 0.2 && quiet < 0.4, 'quiet speech ~ a third: ' + quiet); assert.ok(talk > 0.5 && talk < 0.7, 'normal speech ~ 60%: ' + talk);
  assert.ok(loud > 0.85, 'loud speech nearly full: ' + loud); assert.equal(max, 1); assert.ok(quiet < talk && talk < loud);
});

test('live.js knows how to test, restart and diagnose the microphone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'live.js'), 'utf8');
  for (const name of ['micTest', 'endMicTest', 'restartMic', 'closeMic', 'watchMic', 'emitMic']) assert.match(src, new RegExp(name + '\\('), name);
  assert.match(src, /micDeviceId/); assert.match(src, /bridge:mic/); assert.match(src, /this\.greet \+ ' ' \+ timeNote\(\)/, 'the greeting carries the time');
});

test('a link that gave up is really off: the mic button can start it again (it used to stay "wanted" and only mute)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'live.js'), 'utf8');
  const onclose = src.slice(src.indexOf('ws.onclose'), src.indexOf('send(o)'));
  assert.match(onclose, /this\.want = false; this\.teardown\(\); this\.setState\('offline'\)/, 'onclose ends with want = false');
  assert.ok(onclose.indexOf('this.retries < 3') < onclose.indexOf('this.want = false'), 'retries still come first');
});

test('being quiet never produces a chat warning (it used to say "I hear nothing" between sentences)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'live.js'), 'utf8');
  assert.doesNotMatch(src, /I hear nothing/); assert.match(src, /quiet = rms < 0\.0001/, 'the silence line is about -80 dB, not -54 dB');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'mic-ui.js'), 'utf8'), /silentFor >= 15/, 'NO SIGNAL on the meter needs 15 quiet seconds');
});
