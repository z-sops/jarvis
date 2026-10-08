'use strict';
// HTTP request-handler and profile checks using memory-only transports/filesystems.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createActorAuth, loadActorKey } = require('../lib/gateway-auth');

function load(file, overrides = {}) {
  const filename = path.join(__dirname, '..', file), mod = { exports: {} }, realRequire = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, require: name => overrides[name] || realRequire(name), Buffer, setTimeout, clearTimeout, console }, { filename });
  return mod.exports;
}
function memoryFs() {
  const files = new Map(), writes = [];
  return { files, writes, mkdirSync() {},
    readFileSync: name => { if (!files.has(name)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(name); },
    writeFileSync: (name, data, opts) => { if (opts?.flag === 'wx' && files.has(name)) throw Object.assign(new Error('exists'), { code: 'EEXIST' }); writes.push({ name, opts }); files.set(name, data); },
  };
}
async function serverRig() {
  const actors = new Set(['alex', 'bob', 'bridge-check']), auth = createActorAuth({ key: 'a'.repeat(64), isActiveActor: id => actors.has(id) });
  let handler; const fakeHttp = { createServer: fn => { handler = fn; return { on() {}, listen: (port, host, fn) => fn(), address: () => ({ port: 3039 }), close() {} }; } };
  const calls = [], browserCalls = [];
  const BT = { TOOLS: [{ name: 'browser_open' }], mcpTools: () => [{ name: 'browser_open' }], execute: async (manager, actor, name) => { browserCalls.push({ actor, name }); return { text: 'ok' }; } };
  const { createMcpServer } = load('lib/browser-mcp.js', { http: fakeHttp, './browser-tools': BT });
  const mcp = createMcpServer({ manager: {}, authenticate: auth.authenticate, extra: { list: async actor => [{ name: 'connector__read_' + actor }], call: async (actor, name, args) => { calls.push({ actor, name, args }); return { content: [{ type: 'text', text: actor }] }; } } });
  await mcp.start();
  function request(url, token, body = { jsonrpc: '2.0', id: 1, method: 'ping' }, headers = {}, method = 'POST') {
    return new Promise(resolve => {
      const req = new EventEmitter(); req.url = url; req.method = method; req.headers = { host: '127.0.0.1:3039', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }; req.destroy = () => {};
      const res = { writableEnded: false, writeHead: (status, headers) => { res.status = status; res.headers = headers; }, end: text => { res.writableEnded = true; resolve({ status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }); } };
      handler(req, res); if (!res.writableEnded) { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); }
    });
  }
  return { mcp, auth, actors, calls, browserCalls, request };
}
const tool = name => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { actor: 'commander', from: 'bob' } } });

test('tokens are stable per actor/key but cannot be reused for another actor or derived from an old shared token', () => {
  const active = new Set(['alex', 'bob', 'commander', 'jarvis']), auth = createActorAuth({ key: 'a'.repeat(64), isActiveActor: id => active.has(id) });
  assert.equal(auth.tokenForActor('alex'), auth.tokenForActor('alex')); assert.notEqual(auth.tokenForActor('alex'), auth.tokenForActor('bob'));
  assert.equal(auth.authenticate('bob', auth.tokenForActor('alex')), false); assert.equal(auth.authenticate('alex', 'a'.repeat(64)), false);
  assert.equal(auth.tokenForActor('commander'), null); assert.equal(auth.tokenForActor('jarvis'), null); assert.equal(auth.tokenForActor('unknown'), null); assert.equal(auth.tokenForActor('a/b'), null);
  const old = auth.tokenForActor('alex'); active.delete('alex'); assert.equal(auth.authenticate('alex', old), false);
  assert.throws(() => createActorAuth({ key: 'short', isActiveActor: () => true }));
});

test('the fresh actor key persists with private/exclusive creation; corrupt or unreadable keys are not silently regenerated', () => {
  const io = memoryFs(); io.files.set('/browser/.token', 'OLD_SHARED_TOKEN'); const key = loadActorKey('/browser/.actor-token-key', io);
  assert.match(key, /^[a-f0-9]{64}$/); assert.notEqual(key, 'OLD_SHARED_TOKEN'); assert.equal(loadActorKey('/browser/.actor-token-key', io), key); assert.equal(io.writes.length, 1); assert.equal(io.writes[0].opts.mode, 0o600); assert.equal(io.writes[0].opts.flag, 'wx');
  io.files.set('/browser/.actor-token-key', 'corrupt'); assert.throws(() => loadActorKey('/browser/.actor-token-key', io), /invalid/); assert.equal(io.writes.length, 1);
  assert.throws(() => loadActorKey('key', { readFileSync: () => { throw Object.assign(new Error('unreadable'), { code: 'EACCES' }); } }), /unreadable/);
});

test('gateway refuses Alex token at Bob/commander/unknown paths before any browser or connector call', async () => {
  const r = await serverRig(); try {
    const alex = r.auth.tokenForActor('alex');
    for (const target of ['bob', 'commander', 'jarvis', 'unknown']) assert.equal((await r.request('/mcp/' + target, alex, tool('connector__write'))).status, 401);
    assert.equal((await r.request('/mcp', alex, tool('browser_open'))).status, 404); assert.equal((await r.request('/mcp/alex', 'OLD_SHARED_TOKEN', tool('browser_open'))).status, 401);
    assert.equal(r.calls.length, 0); assert.equal(r.browserCalls.length, 0);
    assert.equal((await r.request('/mcp/alex', alex, tool('connector__write'), { 'x-agent-id': 'commander' })).status, 200); assert.equal(r.calls[0].actor, 'alex');
    await r.request('/mcp/alex', alex, tool('browser_open')); assert.equal(r.browserCalls[0].actor, 'alex');
  } finally { r.mcp.stop(); }
});

test('parallel worker calls stay bound to their tokens and removing a worker immediately refuses future requests', async () => {
  const r = await serverRig(); try {
    const alex = r.auth.tokenForActor('alex'), bob = r.auth.tokenForActor('bob');
    await Promise.all([r.request('/mcp/alex', alex, tool('connector__read')), r.request('/mcp/bob', bob, tool('connector__read'))]); assert.deepEqual(r.calls.map(x => x.actor).sort(), ['alex', 'bob']);
    r.actors.delete('alex'); assert.equal((await r.request('/mcp/alex', alex, tool('connector__read'))).status, 401); assert.equal(r.calls.length, 2);
  } finally { r.mcp.stop(); }
});

test('host, Origin and method defenses remain in place with actor authentication', async () => {
  const r = await serverRig(); try {
    const token = r.auth.tokenForActor('alex');
    assert.equal((await r.request('/mcp/alex', token, undefined, { origin: 'null' })).status, 403);
    assert.equal((await r.request('/mcp/alex', token, undefined, { host: 'evil.example:3039' })).status, 403);
    assert.equal((await r.request('/mcp/alex', token, undefined, {}, 'GET')).status, 405);
    assert.equal((await r.request('/mcp/alex', null)).status, 401); assert.equal(r.calls.length, 0);
  } finally { r.mcp.stop(); }
});

test('crew-check identity can initialize/list but cannot execute browser or connector tools, including batches', async () => {
  const r = await serverRig(); try {
    const token = r.auth.tokenForActor('bridge-check');
    for (const method of ['initialize', 'tools/list', 'ping']) assert.equal((await r.request('/mcp/bridge-check', token, { jsonrpc: '2.0', id: 1, method })).status, 200);
    const denied = await r.request('/mcp/bridge-check', token, [tool('browser_open'), tool('connector__write')]); assert.ok(denied.body.every(x => x.error.code === -32601)); assert.equal(r.calls.length, 0); assert.equal(r.browserCalls.length, 0);
  } finally { r.mcp.stop(); }
});

test('profile setup gives each worker only its own token and never reuses/exposes the legacy or master key', async () => {
  const io = memoryFs(); io.files.set('/home/browser/.token', 'OLD_SHARED_TOKEN'); const roster = new Map([['alex', { id: 'alex' }], ['bob', { id: 'bob' }]]);
  const home = { p: (...bits) => '/home/' + bits.join('/'), getAgent: id => roster.get(id) || null };
  const actualAuth = require('../lib/gateway-auth');
  class Manager extends EventEmitter { dispose() {} }
  let options;
  const panel = load('lib/browser-panel.js', { fs: io, './browser': { BrowserManager: Manager }, './browser-mcp': { createMcpServer: opts => { options = opts; return { port: 3039, url: id => 'http://127.0.0.1:3039/mcp/' + id, stop() {} }; } }, './gateway-auth': { ...actualAuth, loadActorKey: file => actualAuth.loadActorKey(file, io) } });
  const browser = panel.create({ electron: {}, home, getCfg: () => ({}), store: {}, bus: { on() {}, emit() {} }, send() {}, label: id => id });
  try {
    const a = browser.crewYaml({ id: 'alex' }), b = browser.crewYaml({ id: 'bob' }), master = io.files.get('/home/browser/.actor-token-key');
    assert.match(a.top, /Bearer \$\{ORBIT_GATEWAY_ACTOR_TOKEN\}/); assert.notEqual(a.env[0], b.env[0]); assert.ok(!JSON.stringify(a).includes(master)); assert.ok(!JSON.stringify(a).includes('OLD_SHARED_TOKEN'));
    const tok = a.env[0].split('=')[1]; assert.equal(options.authenticate('alex', tok), true); assert.equal(options.authenticate('bob', tok), false);
    const probe = browser.crewYaml({ id: 'bridge-check' }, { force: true }); assert.ok(probe.env[0]); assert.equal((await options.extra.list('bridge-check')).length, 0);
    assert.throws(() => browser.crewYaml({ id: 'commander' }), /reserved/); assert.throws(() => browser.crewYaml({ id: 'unknown' }), /unknown/);
    roster.delete('alex'); assert.equal(options.authenticate('alex', tok), false); assert.throws(() => browser.crewYaml({ id: 'alex' }), /unknown/);
  } finally { browser.dispose(); }
});
