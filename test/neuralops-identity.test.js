'use strict';
// In-memory regression checks: no sockets, model calls, child processes or temporary files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeIdentities, identityFor } = require('../lib/neuralops-identity');
const { Connectors } = require('../lib/connectors');
const { Hub } = require('../lib/hub');

function load(file, overrides = {}) {
  const filename = path.join(__dirname, '..', file), mod = { exports: {} };
  const localRequire = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, require: n => overrides[n] || localRequire(n), URL, AbortController, setTimeout, setInterval, clearInterval, console }, { filename });
  return mod.exports;
}
const identity = { alex: 'agent.alex', bob: 'agent.bob', commander: 'agent.laila' };
function rig({ answer = 'once' } = {}) {
  const requests = [], events = [], clients = [], revoked = new Set();
  const tools = ['neuralops_whoami', 'neuralops_claim', 'neuralops_handoff', 'neuralops_accept_handoff', 'neuralops_authorize'].map(name => ({ name, inputSchema: { type: 'object' } }));
  const tasks = new Map();
  class Transport { constructor(url, opts) { this.headers = opts.requestInit.headers; } }
  class Client {
    async connect(transport) { this.headers = transport.headers; this.closed = false; clients.push(this); }
    async listTools() { return { tools }; }
    async callTool({ name, arguments: args }) {
      await Promise.resolve(); // overlap two clients to catch mutable shared identity
      const actor = this.headers['X-Agent-Id'];
      requests.push({ name, args, actor, authorization: this.headers.Authorization });
      if (!actor || revoked.has(actor)) { const e = new Error('Forbidden'); e.code = 403; throw e; }
      if (name === 'neuralops_claim') tasks.set(args.taskId, { owner: actor });
      if (name === 'neuralops_handoff') { const t = tasks.get(args.taskId); assert.equal(t.owner, actor); t.pending = args.to; }
      if (name === 'neuralops_accept_handoff') { const t = tasks.get(args.taskId); assert.equal(t.pending, actor); t.owner = actor; delete t.pending; }
      return { content: [{ type: 'text', text: JSON.stringify({ actor, owner: tasks.get(args.taskId)?.owner }) }] };
    }
    async close() { this.closed = true; }
  }
  const Up = load('lib/upstream.js', {
    '@modelcontextprotocol/sdk/client/index.js': { Client },
    '@modelcontextprotocol/sdk/client/streamableHttp.js': { StreamableHTTPClientTransport: Transport },
    '@modelcontextprotocol/sdk/client/sse.js': { SSEClientTransport: Transport },
  });
  const { Gateway } = load('lib/gateway.js', { './upstream': Up });
  let record = { id: 'neuralops', catalogId: 'neuralops', name: 'NeuralOps', url: 'http://127.0.0.1:3031/mcp', enabled: true, agents: 'all', tools: tools.map(t => t.name), levels: Object.fromEntries(tools.map(t => [t.name, t.name === 'neuralops_authorize' ? 'ask' : 'free'])), neuralopsIdentities: { ...identity } };
  const connectors = {
    list: () => [record], get: id => id === record.id ? record : null, token: () => 'nops_fake_broker_for_test_only',
    visibleTo: (c, actor) => c.agents === 'all' || c.agents.includes(actor),
    levelOf: (id, tool) => record.levels[tool] || 'blocked', nativeLevels: () => ({}),
  };
  const hub = new Hub({ ask: async () => typeof answer === 'function' ? answer() : answer });
  const gw = new Gateway({ connectors, hub, bus: { on() {}, emit: (type, e) => events.push({ type, ...e }) } });
  return { gw, connectors, requests, events, clients, revoked, tasks, Upstream: Up.Upstream, record: () => record, update: patch => { record = { ...record, ...patch }; } };
}
const call = (r, actor, tool, args = {}) => r.gw.call(actor, 'neuralops__' + tool, args);

test('mapping rejects human identities, duplicate identities and malformed actor/header values', () => {
  assert.deepEqual({ ...normalizeIdentities(identity) }, identity);
  assert.deepEqual({ ...normalizeIdentities({ alex: '' }) }, {});
  for (const ids of [{ alex: 'human.zee' }, { alex: 'agent.alex', bob: 'agent.alex' }, { alex: 'agent.alex\r\nX-Other: bad' }, JSON.parse('{"__proto__":"agent.alex"}'), [], null]) assert.throws(() => normalizeIdentities(ids));
  assert.throws(() => identityFor({ catalogId: 'neuralops', neuralopsIdentities: identity }, 'eve'), /not configured/);
  assert.equal(identityFor({ catalogId: 'github' }, 'alex'), null);
});

test('saved identity changes alter worker configuration signatures; invalid mappings never save', () => {
  let rec = { id: 'neuralops', catalogId: 'neuralops', enabled: true, agents: 'all', neuralopsIdentities: { ...identity } };
  const c = Object.create(Connectors.prototype); c.list = () => [rec]; c.get = () => rec; c.update = (id, patch) => { rec = { ...rec, ...patch }; return rec; }; c.nativeLevels = () => ({});
  const sig = c.signature('alex'); c.setNeuralopsIdentities('neuralops', { ...identity, alex: 'agent.alex2' }); assert.notEqual(c.signature('alex'), sig);
  assert.throws(() => c.setNeuralopsIdentities('neuralops', { alex: 'human.zee' })); assert.equal(rec.neuralopsIdentities.alex, 'agent.alex2');
});

test('parallel Alex/Bob calls have different bound headers; tool arguments cannot switch actor', async () => {
  const r = rig(); try {
    const out = await Promise.all([call(r, 'alex', 'neuralops_whoami', { from: 'agent.bob', agentId: 'human.zee' }), call(r, 'bob', 'neuralops_whoami'), call(r, 'commander', 'neuralops_whoami')]);
    assert.ok(out.every(x => !x.isError)); assert.deepEqual(r.requests.map(x => x.actor), ['agent.alex', 'agent.bob', 'agent.laila']);
    assert.equal(r.clients.length, 3); assert.ok(r.requests.every(x => x.authorization === 'Bearer nops_fake_broker_for_test_only'));
    assert.ok(!JSON.stringify(r.events).includes('nops_fake'));
  } finally { await r.gw.closeAll(); }
});

test('missing mappings fail closed before asking or contacting the server; tool discovery alone is not readiness', async () => {
  let asks = 0; const r = rig({ answer: () => { asks++; return 'once'; } }); try {
    r.update({ neuralopsIdentities: {} }); assert.equal((await r.gw.test('neuralops')).ok, true);
    assert.equal((await r.gw.list('alex')).length, 0);
    const out = await call(r, 'alex', 'neuralops_authorize'); assert.ok(out.isError); assert.match(out.content[0].text, /not configured/);
    assert.equal(r.requests.length, 0); assert.equal(asks, 0);
  } finally { await r.gw.closeAll(); }
});

test('handoff calls preserve Alex/Bob ownership at the gateway boundary', async () => {
  const r = rig(); try {
    await call(r, 'alex', 'neuralops_claim', { taskId: 'task_one' });
    await call(r, 'alex', 'neuralops_handoff', { taskId: 'task_one', to: 'agent.bob' });
    await call(r, 'bob', 'neuralops_accept_handoff', { taskId: 'task_one' });
    assert.equal(r.tasks.get('task_one').owner, 'agent.bob'); assert.deepEqual(r.requests.map(x => x.actor), ['agent.alex', 'agent.alex', 'agent.bob']);
  } finally { await r.gw.closeAll(); }
});

test('a server refusal for a revoked delegate never falls back to the shared broker identity', async () => {
  const r = rig(); try {
    await call(r, 'alex', 'neuralops_whoami'); r.revoked.add('agent.alex');
    const out = await call(r, 'alex', 'neuralops_claim', { taskId: 'task_one' }); assert.ok(out.isError); assert.match(out.content[0].text, /403/);
    assert.equal(r.tasks.size, 0); assert.ok(r.requests.every(x => x.actor === 'agent.alex')); assert.equal(r.clients.length, 1);
  } finally { await r.gw.closeAll(); }
});

test('approval refusal and connector allowlists remain enforced', async () => {
  const r = rig({ answer: 'deny' }); try {
    assert.ok((await call(r, 'alex', 'neuralops_authorize')).isError); assert.equal(r.requests.length, 0);
    r.update({ agents: ['alex'] }); assert.ok((await call(r, 'bob', 'neuralops_whoami')).isError); assert.equal(r.requests.length, 0);
  } finally { await r.gw.closeAll(); }
});

test('mapping changes while an approval is pending cannot redirect the authorized call', async () => {
  let r; r = rig({ answer: () => { r.update({ neuralopsIdentities: { ...identity, alex: 'agent.other' } }); return 'once'; } }); try {
    const out = await call(r, 'alex', 'neuralops_authorize'); assert.ok(out.isError); assert.match(out.content[0].text, /identity changed/); assert.equal(r.requests.length, 0);
  } finally { await r.gw.closeAll(); }
});

test('closing or retesting a connector closes all identity-bound clients and clears their caches', async () => {
  const r = rig(); try {
    await r.gw.list('alex'); await r.gw.list('bob'); assert.equal(r.gw.cache.size, 2);
    await r.gw.test('neuralops'); assert.ok(r.clients.every(c => c.closed)); assert.equal(r.gw.ups.size, 0); assert.equal(r.gw.cache.size, 0);
    r.update({ neuralopsIdentities: { ...identity, alex: 'agent.newalex' } }); await call(r, 'alex', 'neuralops_whoami'); assert.equal(r.requests.at(-1).actor, 'agent.newalex');
  } finally { await r.gw.closeAll(); }
});

test('other services retain bearer-only headers and existing native actor forwarding', async () => {
  const r = rig(); try {
    const u = new r.Upstream({ id: 'github', url: 'https://example.com/mcp', token: 'fake' }); assert.deepEqual({ ...u.headers() }, { Authorization: 'Bearer fake' });
    assert.throws(() => new r.Upstream({ id: 'neuralops', url: 'http://127.0.0.1:3031/mcp', agentId: 'human.zee' }));
    r.update({ catalogId: 'github' }); assert.equal(r.gw.up(r.record(), 'alex'), r.gw.up(r.record(), 'bob'));
    r.update({ native: 'library', catalogId: 'library' }); const calls = [];
    r.gw.providers.library = () => ({ id: 'neuralops', sig: '[]', listTools: async () => [], callTool: async (name, args, opts) => { calls.push(opts.actor); return { content: [{ type: 'text', text: 'ok' }] }; }, close: async () => {}, abort() {} });
    await r.gw.close('neuralops'); await call(r, 'alex', 'neuralops_whoami'); assert.deepEqual(calls, ['alex']);
  } finally { await r.gw.closeAll(); }
});

test('identity IPC exposes only mappings, validates saves and closes stale clients', async () => {
  const handlers = {}, r = rig(), closed = [], contents = {};
  const panel = load('lib/connectors-panel.js', { './fsmcp': { checkRoots: () => ({ ok: false }) } });
  r.connectors.setNeuralopsIdentities = (id, ids) => r.update({ neuralopsIdentities: normalizeIdentities(ids) });
  panel.register({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, connectors: r.connectors, gateway: { close: async id => closed.push(id) }, store: { get: () => ({ engine: 'hermes' }) }, bus: { on() {}, emit() {} }, win: () => ({ webContents: contents }) });
  try {
    const evt = { sender: contents }, listed = await handlers['connectors:list'](evt);
    assert.ok(!JSON.stringify(listed).includes('nops_fake')); assert.deepEqual({ ...listed.connectors[0].neuralopsIdentities }, identity);
    const save = ids => handlers['connectors:update'](evt, 'neuralops', { neuralopsIdentities: ids });
    assert.equal((await save({ alex: 'human.zee' })).ok, false); assert.equal(closed.length, 0);
    assert.equal((await save({ alex: 'agent.alex', bob: 'agent.bob' })).ok, true); assert.deepEqual(closed, ['neuralops']);
    assert.equal((await handlers['connectors:update']({ sender: {} }, 'neuralops', { neuralopsIdentities: {} })).ok, false);
  } finally { await r.gw.closeAll(); }
});

test('the identity form includes Laila and workers, saves mappings and displays validation errors', async () => {
  class Element {
    constructor(tag) { this.tag = tag; this.nodeType = 1; this.kids = []; this.attrs = {}; this.listeners = {}; this.classList = { add() {}, remove() {} }; }
    set textContent(value) { this.text = value; this.kids = []; }
    get textContent() { return (this.text || '') + this.kids.map(k => k.textContent || '').join(''); }
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'value') this.value = v; if (k === 'type') this.type = v; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    append(...kids) { this.kids.push(...kids); }
  }
  const body = new Element('body'); body.dataset = {}; const document = { body, createElement: t => new Element(t), createTextNode: s => ({ nodeType: 3, textContent: s }) };
  const record = { id: 'neuralops', catalogId: 'neuralops', name: 'NeuralOps', url: 'http://127.0.0.1:3031/mcp', enabled: true, agents: 'all', mode: 'read-only', tools: [], neuralopsIdentities: { ...identity } };
  const saved = []; const window = {};
  const bridge = { onBus() {}, agents: { list: async () => [{ id: 'alex', name: 'Alex' }, { id: 'bob', name: 'Bob' }] }, connectors: { list: async () => ({ ok: true, catalog: [], connectors: [record], native: [], engine: 'hermes' }), update: async (id, patch) => { saved.push({ id, patch }); return { ok: false, error: 'Each Orbit worker needs a different NeuralOps identity.' }; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/js/connectors-ui.js'), 'utf8'), { document, window, bridge, URL, setTimeout, alert() {}, confirm() { return false; } });
  await window.__connectors.enter();
  const find = predicate => { const all = []; const visit = e => { if (predicate(e)) all.push(e); for (const child of e.kids || []) visit(child); }; visit(body); return all; };
  const fields = find(e => e.tag === 'input' && String(e.attrs['aria-label'] || '').startsWith('NeuralOps identity for '));
  assert.equal(fields.length, 3); assert.equal(fields[0].value, 'agent.laila'); assert.equal(fields[1].value, 'agent.alex');
  fields[2].value = 'agent.alex'; const save = find(e => e.tag === 'button' && e.textContent === 'Save worker identities')[0]; await save.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(saved[0])), { id: 'neuralops', patch: { neuralopsIdentities: { commander: 'agent.laila', alex: 'agent.alex', bob: 'agent.alex' } } });
  assert.ok(find(e => e.attrs?.role === 'status').some(e => /different NeuralOps identity/.test(e.textContent))); assert.equal(save.disabled, false);
});
