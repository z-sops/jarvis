'use strict';
// Deterministic tests for the Comms hub supervisor. They use test/fake-hermes.js, so they need no Hermes and no network.
// The fake is started through a launcher inside a temp directory whose name contains a space,
// so these tests also prove that a hermesPath with a space works.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter } = require('events');
const { Home } = require('../lib/home');
const { HermesEngine } = require('../lib/hermes');
const { CommsHub } = require('../lib/comms');
const { killTree } = require('./helpers');

const FAKE = path.join(__dirname, 'fake-hermes.js');
const good = { telegram: { enabled: true, token: '123456789:AAFakeTokenForTestingOnly_abcdefghijklmn', allowed: '111222333' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The launcher must NOT set HERMES_HOME: the fake inherits it from HermesEngine.
function launcher(dir, mode) {
  if (process.platform === 'win32') {
    const f = path.join(dir, 'hermes.cmd');
    fs.writeFileSync(f, `@echo off\r\nset "FAKE_HERMES_MODE=${mode}"\r\nnode "${FAKE}" %*\r\n`);
    return f;
  }
  const f = path.join(dir, 'hermes');
  fs.writeFileSync(f, `#!/bin/sh\nFAKE_HERMES_MODE="${mode}" exec node "${FAKE}" "$@"\n`, { mode: 0o755 });
  return f;
}

function hubFor(prefix, mode, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix + ' ')); // the space is on purpose
  const bin = launcher(dir, mode);
  const home = new Home(path.join(dir, 'BridgeHome')).ensure();
  const cfg = { aiName: 'Nova', gender: 'female', userName: 'Zee', userTitle: 'CEO', lang: 'mix', engine: 'hermes', hermesPath: bin, workerProvider: 'custom', workerModel: 'm', workerApiKey: 'k', workerBaseUrl: 'http://127.0.0.1:1/v1', comms: {} };
  const engine = new HermesEngine({ requireContainment: false, home, getCfg: () => cfg });
  const bus = new EventEmitter(); const events = []; bus.on('comms:event', e => events.push(e.text));
  const hub = new CommsHub({ home, getCfg: () => cfg, setCfg: p => Object.assign(cfg, p), hermes: engine, bus, restartBaseMs: 20, restartMaxMs: 200, ...opts });
  let starts = 0; const orig = hub.start.bind(hub); hub.start = function () { starts++; return orig(); };
  return { hub, events, starts: () => starts };
}

test('supervisor restarts a gateway that crashes (killTree, new pid, Restarting event)', async () => {
  const { hub, events } = hubFor('bridge-sup', 'alive');
  try {
    const r = await hub.save({ telegram: good.telegram });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(hub.proc, 'gateway started');
    const oldPid = hub.proc.pid; killTree(oldPid);
    for (let i = 0; i < 40 && !(hub.proc && hub.proc.pid !== oldPid); i++) await sleep(500);
    assert.ok(hub.proc && hub.proc.pid !== oldPid, 'gateway restarted after a crash');
    assert.ok(events.some(e => /Restarting/.test(e)), 'a Restarting event is emitted: ' + JSON.stringify(events));
  } finally { hub.stop(); }
});

test('supervisor does not restart a gateway that exits fatally (code 78, startup_failed, fatal platform)', async () => {
  const { hub, events, starts } = hubFor('bridge-fat', 'fatal');
  try {
    const r = await hub.save({ telegram: good.telegram });
    assert.equal(r.ok, true, JSON.stringify(r));
    for (let i = 0; i < 60 && hub.status().platforms.telegram.state !== 'fatal'; i++) await sleep(500);
    assert.equal(hub.status().platforms.telegram.state, 'fatal', 'fatal platform state is reported: ' + JSON.stringify(hub.status()));
    assert.equal(hub.proc, null, 'the process is gone after a fatal exit');
    await sleep(3000); // with 20 ms backoff a restart would have happened long before this
    assert.equal(starts(), 1, 'the gateway was started exactly once');
    assert.equal(hub.proc, null, 'no restart after a fatal exit');
    assert.equal(hub.status().platforms.telegram.state, 'fatal', 'fatal state persists after the process is gone');
    assert.ok(hub.status().platforms.telegram.error, 'the reason is available to the UI');
    assert.ok(!events.some(e => /Restarting/.test(e)), 'a fatal exit must not trigger a restart: ' + JSON.stringify(events));
    assert.equal(events.filter(e => /reject/i.test(e)).length, 1, 'exactly one event reports the rejected token: ' + JSON.stringify(events));
    // fixing the settings and saving again clears the remembered fatal state and starts a fresh gateway
    await hub.save({ telegram: good.telegram });
    assert.equal(starts(), 2, 'save starts the gateway again');
  } finally { hub.stop(); }
});

test('supervisor stops restarting after 5 crashes in 5 minutes and reports it', async () => {
  const { hub, events, starts } = hubFor('bridge-cr', 'crash');
  try {
    const r = await hub.save({ telegram: good.telegram });
    assert.equal(r.ok, true, JSON.stringify(r));
    for (let i = 0; i < 120 && !events.some(e => /keeps crashing/.test(e)); i++) await sleep(500);
    assert.ok(events.some(e => /keeps crashing/.test(e)), 'the supervisor gives up after repeated crashes: ' + JSON.stringify(events));
    assert.equal(hub.proc, null, 'no process left after the restart cap');
    assert.equal(starts(), 6, 'one first start plus five restarts');
    await sleep(1000);
    assert.equal(starts(), 6, 'no further start after the cap is hit');
  } finally { hub.stop(); }
});

test('CommsHub defaults: production timing is unchanged when no options are passed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-defaults-'));
  const home = new Home(path.join(dir, 'BridgeHome')).ensure();
  const cfg = { aiName: 'Nova', engine: 'hermes', hermesPath: 'hermes', comms: {} };
  const hub = new CommsHub({ home, getCfg: () => cfg, setCfg: () => {}, hermes: new HermesEngine({ requireContainment: false, home, getCfg: () => cfg }), bus: new EventEmitter() });
  assert.equal(hub.restartBaseMs, 2000); assert.equal(hub.restartMaxMs, 60000);
  assert.equal(hub.maxRestarts, 5); assert.equal(hub.restartWindowMs, 300000);
});
