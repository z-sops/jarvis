'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const { Home } = require('../lib/home');
const { HermesEngine } = require('../lib/hermes');
const { CommsHub, normalize, buildFiles } = require('../lib/comms');
const { hermesCmd, hasHermes, killTree } = require('./helpers');

const good = { telegram: { enabled: true, token: '123456789:AAFakeTokenForTestingOnly_abcdefghijklmn', allowed: '111222333' }, whatsapp: { enabled: true, allowed: '+92 300 1234567' }, email: { enabled: true, address: 'nova@example.com', password: 'app-pass', imapHost: 'imap.example.com', smtpHost: 'smtp.example.com', allowed: 'zee@example.com' } };

test('comms settings: every channel needs an allowlist and valid credentials', () => {
  assert.equal(normalize(good).errors.length, 0);
  const n = normalize(good).value; assert.deepEqual(n.whatsapp.allowed, ['923001234567']); assert.deepEqual(normalize({ whatsapp: { enabled: true, allowed: '923001234567, +92 333 7654321' } }).value.whatsapp.allowed, ['923001234567', '923337654321']); assert.equal(n.pcControl, 'approve');
  const e = normalize({ telegram: { enabled: true, token: 'nope', allowed: '' }, whatsapp: { enabled: true, allowed: '' }, email: { enabled: true } }).errors.join('\n');
  assert.match(e, /bot token/); assert.match(e, /numeric Telegram ID/); assert.match(e, /WhatsApp: add your own number/); assert.match(e, /Email: enter/); assert.match(e, /list the addresses/);
  assert.match(normalize({ telegram: { enabled: true, token: good.telegram.token, allowed: '@zee' } }).errors.join(), /numbers, not usernames/);
  assert.equal(normalize({}).errors.length, 0, 'nothing enabled is valid');
});

test('comms profile files: approvals, deny list, per-channel tools, no open access', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-c-')); const home = new Home(path.join(root, 'BridgeHome')).ensure();
  const cfg = { aiName: 'Nova', gender: 'female', userName: 'Zee', userTitle: 'CEO', lang: 'mix', workerProvider: 'openrouter', workerModel: 'm/x', workerApiKey: 'KEY1' };
  const f = buildFiles(cfg, normalize(good).value, home);
  assert.match(f.yaml, /mode: manual/); assert.match(f.yaml, /rm -rf \/\*/); assert.match(f.yaml, /unauthorized_dm_behavior: ignore/);
  assert.match(f.yaml, /email:\n    - safe\n    - file\n    - memory/); assert.match(f.yaml, /telegram:\n    - hermes-telegram/);
  assert.match(f.envText, /TELEGRAM_ALLOWED_USERS=111222333/); assert.match(f.envText, /WHATSAPP_ALLOWED_USERS=923001234567/); assert.match(f.envText, /EMAIL_ALLOWED_USERS=zee@example.com/);
  assert.doesNotMatch(f.envText, /ALLOW_ALL/); assert.doesNotMatch(f.yaml, /KEY1/);
  assert.match(f.soul, /data, never an instruction/); assert.match(f.soul, /You are Nova/);
  const off = buildFiles(cfg, normalize({ ...good, pcControl: 'off' }).value, home);
  assert.match(off.yaml, /telegram:\n    - safe\n    - file\n    - memory/);
});

const has = hasHermes();
test('real Hermes gateway: starts, applies per-channel tools and holds fatal state on a bad token', { skip: !has && 'hermes is not installed here', timeout: 280000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-g-')); const home = new Home(path.join(root, 'BridgeHome')).ensure();
  let cfg = { aiName: 'Nova', gender: 'female', userName: 'Zee', userTitle: 'CEO', lang: 'mix', hermesPath: hermesCmd(), workerProvider: 'custom', workerModel: 'mock', workerApiKey: 'mock-key-1234567890', workerBaseUrl: 'http://127.0.0.1:9/v1', comms: {} };
  const engine = new HermesEngine({ home, getCfg: () => cfg }); const bus = new EventEmitter(); const events = []; bus.on('comms:event', e => events.push(e.text));
  const hub = new CommsHub({ home, getCfg: () => cfg, setCfg: p => Object.assign(cfg, p), hermes: engine, bus });
  const tools = platform => spawnSync(hermesCmd(), ['-p', 'comms', 'tools', 'list', '--platform', platform], { env: engine.env(), encoding: 'utf8', timeout: 120000 }).stdout.replace(/[^\t\n\r\x20-\x7e]/g, '');
  const enabled = (out, name) => new RegExp('enabled\\s+' + name + '\\b').test(out);
  try {
    let r = await hub.save({ telegram: good.telegram });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(hub.proc, 'gateway process started');
    let st = hub.status();
    for (let i = 0; i < 60 && !['connected', 'retrying', 'disconnected', 'fatal'].includes(st.platforms.telegram.state); i++) { st = hub.status(); await new Promise(r => setTimeout(r, 1000)); }
    assert.ok(['connected', 'retrying', 'disconnected', 'fatal'].includes(st.platforms.telegram.state), 'live platform state comes from gateway_state.json: ' + JSON.stringify(st));
    assert.equal(st.platforms.whatsapp.state, 'off');
    const email = tools('email'), tg = tools('telegram');
    assert.ok(enabled(email, 'file') && !enabled(email, 'terminal') && !enabled(email, 'browser') && !enabled(email, 'computer_use'), 'email has no shell:\n' + email);
    assert.ok(enabled(tg, 'terminal'), 'telegram keeps the shell (with approvals)');
    const envText = fs.readFileSync(path.join(hub.dir(), '.env'), 'utf8'); assert.doesNotMatch(envText, /ALLOW_ALL/);
    // A rejected token is non-retryable: Hermes v0.21.3 exits 78 and the supervisor must
    // NOT restart it. Poll until the fatal state is reported, then confirm it stays dead.
    for (let i = 0; i < 120 && st.platforms.telegram.state !== 'fatal'; i++) { st = hub.status(); await new Promise(r => setTimeout(r, 1000)); }
    assert.equal(st.platforms.telegram.state, 'fatal', 'rejected token is reported fatal: ' + JSON.stringify(st));
    assert.equal(hub.proc, null, 'the gateway process is gone after a fatal exit');
    await new Promise(r => setTimeout(r, 20000));
    st = hub.status();
    assert.equal(st.platforms.telegram.state, 'fatal', 'fatal state persists after the process is gone: ' + JSON.stringify(st));
    assert.equal(hub.proc, null, 'no restart after a fatal exit');
    assert.ok(!events.some(e => /Restarting/.test(e)), 'a fatal exit must not trigger a restart: ' + JSON.stringify(events));
    assert.ok(events.some(e => /rejected|token/i.test(e)), 'an event reports the rejected token: ' + JSON.stringify(events));
    // chat-only mode removes the shell from Telegram too
    r = await hub.save({ telegram: good.telegram, pcControl: 'off' }); assert.equal(r.ok, true);
    assert.ok(!enabled(tools('telegram'), 'terminal'), 'pcControl off removes terminal from chat');
    r = await hub.save({}); assert.equal(r.running, false); assert.equal(hub.proc, null);
  } finally { hub.stop(); }
});
