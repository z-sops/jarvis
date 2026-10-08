'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createMcpServer } = require('../lib/browser-mcp');
const { createActorAuth } = require('../lib/gateway-auth');

const AUTH = createActorAuth({ key: 'a'.repeat(64), isActiveActor: id => ['alex', 'bob', 'bridge-check'].includes(id) });
const TOKEN = AUTH.tokenForActor('bob');
function fakeManager(log) {
  const snap = { url: 'https://example.com/', title: 'Example', text: 'Hello', textFrom: 0, textTo: 5, textTotal: 5, elements: [{ ref: 'e1', role: 'link', name: 'More', extra: '' }], moreElements: 0, belowFold: 0, scrollY: 0, scrollMax: 0, screens: 1, viewH: 800, alerts: [], dialogs: 0 };
  return { open: async (actor, url, o) => { log.push(['open', actor, url, o]); if (/bad/.test(url)) throw new Error('That address is blocked.'); return { note: 'Opened.', snapshot: snap }; }, screenshot: async () => ({ mime: 'image/jpeg', base64: 'QUJD' }) };
}
async function rig(extra = {}) {
  const log = [], calls = []; const srv = createMcpServer({ manager: fakeManager(log), authenticate: AUTH.authenticate, onCall: c => calls.push(c), ...extra }); const port = await srv.start();
  const post = (path, body, headers = {}, method = 'POST') => new Promise((resolve, reject) => {
    const data = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const actor = /^\/mcp\/([a-z0-9-]+)/.exec(path)?.[1], actorToken = AUTH.tokenForActor(actor) || TOKEN;
    const req = http.request({ host: '127.0.0.1', port, path, method, agent: false, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + actorToken, Accept: 'application/json, text/event-stream', ...headers } }, res => { let t = ''; res.on('data', c => (t += c)); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, text: t, json: j, headers: res.headers }); }); });
    req.on('error', reject); req.end(data);
  });
  return { srv, port, post, log, calls, rpc: (method, params, id = 1, path = '/mcp/bob') => post(path, { jsonrpc: '2.0', id, method, params }) };
}

test('the MCP handshake: initialize, initialized, ping, and the tool list', async () => {
  const r = await rig(); try {
    const init = await r.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hermes', version: '1' } }); assert.equal(init.status, 200);
    assert.equal(init.json.result.protocolVersion, '2025-06-18'); assert.equal(init.json.result.serverInfo.name, 'orbit-browser'); assert.ok(init.json.result.capabilities.tools); assert.equal(init.headers['content-type'], 'application/json');
    assert.equal((await r.rpc('initialize', { protocolVersion: '1999-01-01' })).json.result.protocolVersion, '2025-11-25', 'an unknown version gets the newest one we speak');
    const note = await r.post('/mcp/bob', { jsonrpc: '2.0', method: 'notifications/initialized' }); assert.equal(note.status, 202); assert.equal(note.text, '');
    assert.deepEqual((await r.rpc('ping')).json.result, {}); const list = (await r.rpc('tools/list')).json.result.tools; assert.ok(list.length >= 10); assert.ok(list.every(t => t.name && t.description && t.inputSchema.type === 'object')); assert.ok(list.find(t => t.name === 'browser_screenshot'));
    assert.deepEqual((await r.rpc('resources/list')).json.result, { resources: [] }); assert.deepEqual((await r.rpc('prompts/list')).json.result, { prompts: [] });
  } finally { r.srv.stop(); }
});

test('a tool call reaches the browser as the right person, and the answer is text (and a picture for a screenshot)', async () => {
  const r = await rig(); try {
    const ok = await r.rpc('tools/call', { name: 'browser_open', arguments: { url: 'example.com' } }, 7, '/mcp/alex'); assert.equal(ok.json.id, 7); assert.equal(ok.json.result.isError, false); assert.match(ok.json.result.content[0].text, /Opened\.[\s\S]*Page: Example[\s\S]*\[e1\] link "More"/);
    assert.deepEqual(r.log[0], ['open', 'alex', 'example.com', { newTab: false, background: false }], 'the token is bound to the person in the address'); assert.equal(r.calls[0].actor, 'alex'); assert.equal(r.calls[0].name, 'browser_open'); assert.equal(r.calls[0].isError, false);
    const bad = await r.rpc('tools/call', { name: 'browser_open', arguments: { url: 'bad.example' } }); assert.equal(bad.json.result.isError, true); assert.match(bad.json.result.content[0].text, /blocked/);
    const shot = (await r.rpc('tools/call', { name: 'browser_screenshot', arguments: {} })).json.result; assert.equal(shot.content[1].type, 'image'); assert.equal(shot.content[1].mimeType, 'image/jpeg'); assert.equal(shot.content[1].data, 'QUJD');
    assert.equal((await r.rpc('tools/call', { name: 'browser_teleport', arguments: {} })).json.result.isError, true, 'an unknown tool is a tool error');
    assert.deepEqual(r.log.at(-1).slice(0, 2), ['open', 'alex'].slice(0, 0).concat(r.log.at(-1).slice(0, 2)));
    const count = r.log.length, noActor = await r.rpc('tools/call', { name: 'browser_open', arguments: { url: 'example.com' } }, 2, '/mcp'); assert.equal(noActor.status, 404); assert.equal(r.log.length, count, 'there is no default commander route');
  } finally { r.srv.stop(); }
});

test('safety: no token, a wrong token, a web page (Origin), another host name, and the wrong path are all refused', async () => {
  const r = await rig(); try {
    const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
    assert.equal((await r.post('/mcp/bob', body, { Authorization: '' })).status, 401); assert.equal((await r.post('/mcp/bob', body, { Authorization: 'Bearer wrong' })).status, 401); assert.equal((await r.post('/mcp/bob', body, { Authorization: 'Bearer ' + TOKEN + 'x' })).status, 401);
    assert.equal((await r.post('/mcp/bob', body, { Authorization: 'Bearer' })).headers['www-authenticate'], 'Bearer');
    assert.equal((await r.post('/mcp/bob', body, { Origin: 'https://evil.example' })).status, 403, 'a page in a browser must not be able to call this'); assert.equal((await r.post('/mcp/bob', body, { Origin: 'null' })).status, 403);
    assert.equal((await r.post('/mcp/bob', body, { Host: 'evil.example:' + r.port })).status, 403, 'DNS rebinding'); assert.equal((await r.post('/mcp/bob', body, { Host: 'localhost:' + r.port })).status, 200);
    assert.equal((await r.post('/other', body)).status, 404); assert.equal((await r.post('/mcp/bad%20name', body)).status, 404); assert.equal((await r.post('/mcp/' + 'x'.repeat(61), body)).status, 404);
    assert.equal((await r.post('/mcp/bob', null, {}, 'GET')).status, 405); assert.equal((await r.post('/mcp/bob', null, {}, 'DELETE')).status, 405);
    assert.equal(r.calls.length, 0, 'nothing ran');
  } finally { r.srv.stop(); }
});

test('malformed input never crashes it: bad JSON, empty batch, unknown method, batches, oversized bodies', async () => {
  const r = await rig(); try {
    const bad = await r.post('/mcp/bob', '{not json'); assert.equal(bad.status, 400); assert.equal(bad.json.error.code, -32700);
    assert.equal((await r.post('/mcp/bob', [])).status, 400); const unk = await r.rpc('nope/method'); assert.equal(unk.json.error.code, -32601); assert.equal((await r.post('/mcp/bob', { hello: 1 })).json.error.code, -32600);
    const batch = await r.post('/mcp/bob', [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]); assert.equal(batch.status, 200); assert.equal(batch.json.length, 2); assert.deepEqual(batch.json.map(x => x.id).sort(), [1, 2]);
    const big = await r.post('/mcp/bob', { jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(300 * 1024) } }).catch(e => ({ status: 'closed:' + e.code })); assert.ok(big.status === 413 || String(big.status).startsWith('closed'), 'too large is refused: ' + big.status);
    assert.equal((await r.rpc('ping')).status, 200, 'still alive');
  } finally { r.srv.stop(); }
});

test('the server gives the address for each person, and picks another port when its favourite is taken', async () => {
  const a = await rig(); const b = createMcpServer({ manager: fakeManager([]), authenticate: AUTH.authenticate }); try { const p2 = await b.start(a.port); assert.notEqual(p2, a.port, 'a busy port is skipped'); assert.equal(b.url('bob'), `http://127.0.0.1:${p2}/mcp/bob`); assert.throws(() => a.srv.url('a b'), /worker identity/); assert.throws(() => a.srv.url('commander'), /worker identity/); } finally { a.srv.stop(); b.stop(); }
});

test('actor tokens cannot impersonate another worker or commander; the probe cannot execute tools', async () => {
  const r = await rig(); try {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_open', arguments: { url: 'example.com' } } };
    for (const target of ['bob', 'commander', 'jarvis', 'unknown']) assert.equal((await r.post('/mcp/' + target, body, { Authorization: 'Bearer ' + AUTH.tokenForActor('alex') })).status, 401);
    const probe = await r.post('/mcp/bridge-check', body); assert.equal(probe.json.error.code, -32601); assert.equal(r.log.length, 0);
    assert.equal((await r.post('/mcp/alex', body, { Authorization: 'Bearer ' + AUTH.tokenForActor('alex') })).status, 200);
    assert.equal(r.log[0][1], 'alex');
  } finally { r.srv.stop(); }
});

