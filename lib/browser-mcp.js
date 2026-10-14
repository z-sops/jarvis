'use strict';
// A small MCP server (Model Context Protocol, "Streamable HTTP", no sessions) on 127.0.0.1 that gives the crew the Orbit Browser tools.
// It only listens on this computer, needs a secret token, and refuses requests that come from a web page (an Origin header).
const http = require('http');
const BT = require('./browser-tools');

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 256 * 1024;

const BT_NAMES = new Set(BT.TOOLS.map(t => t.name));

// extra (optional): the gateway. { list(actor) -> tool definitions, call(actor, name, args) -> { content, isError } }
function createMcpServer({ manager, authenticate, bindRequest = () => fn => fn(), assertCurrent = () => {}, onCall, name = 'orbit-browser', version = '1.0.0', actorName = id => id, extra = null }) {
  let server = null, port = 0;
  if (typeof authenticate !== 'function') throw new Error('Orbit MCP requires actor-bound authentication.');
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id == null ? null : id, error: { code, message } });

  async function handle(msg, actor) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg && msg.id, -32600, 'Invalid request');
    const { id, method, params = {} } = msg, isNote = id === undefined;
    try {
      assertCurrent();
      switch (method) {
        case 'initialize': { const want = params.protocolVersion; return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name, version }, instructions: 'Orbit Browser: a private browser for you. It is separate from the user\'s own browser. Signing in, buying, sending and deleting are approved or done by the user.' } }; }
        case 'notifications/initialized': case 'notifications/cancelled': case 'notifications/roots/list_changed': return null;
        case 'ping': return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list': { let tools = BT.mcpTools(); if (extra) { try { tools = tools.concat(await extra.list(actor)); } catch { /* the browser tools are still offered */ } } return { jsonrpc: '2.0', id, result: { tools } }; }
        case 'resources/list': return { jsonrpc: '2.0', id, result: { resources: [] } };
        case 'resources/templates/list': return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };
        case 'prompts/list': return { jsonrpc: '2.0', id, result: { prompts: [] } };
        case 'logging/setLevel': return { jsonrpc: '2.0', id, result: {} };
        case 'tools/call': {
          if (actor === 'bridge-check') return rpcError(id, -32601, 'The crew access check can discover tools but cannot run them.');
          assertCurrent();
          const tn = String(params.name || '');
          if (extra && !BT_NAMES.has(tn)) { const r = await extra.call(actor, tn, params.arguments || {}); return { jsonrpc: '2.0', id, result: { content: r.content, isError: !!r.isError } }; }
          const t0 = Date.now(), r = await BT.execute(manager, actor, tn, params.arguments || {});
          if (onCall) { try { onCall({ actor, name: params.name, args: params.arguments || {}, ms: Date.now() - t0, isError: !!r.isError }); } catch { /* logging must not break a call */ } }
          const content = [{ type: 'text', text: r.text }]; if (r.image) content.push({ type: 'image', data: r.image.base64, mimeType: r.image.mime });
          return { jsonrpc: '2.0', id, result: { content, isError: !!r.isError } };
        }
        default: return isNote ? null : rpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) { return isNote ? null : rpcError(id, -32603, String((e && e.message) || e)); }
  }

  function onRequest(req, res) {
    const send = (code, body, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)); };
    const m = /^\/mcp\/([a-z0-9][a-z0-9-]{0,40})\/?$/.exec((req.url || '').split('?')[0]);
    if (!m) return send(404, { error: 'not found' });
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(403, { error: 'bad host' });   // DNS rebinding
    if (req.headers.origin) return send(403, { error: 'requests from web pages are not allowed' });                // a page in a browser must never drive this
    const actor = m[1], auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    let allowed = false;
    try { allowed = !!(auth && authenticate(actor, auth[1])); } catch { /* authentication failures never open the gateway */ }
    if (!allowed) return send(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    let dispatch;
    try { dispatch = bindRequest(actor); } catch { return send(401, { error: 'job run expired' }); }
    if (req.method !== 'POST') return send(405, { error: 'use POST' }, { Allow: 'POST' });
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { send(413, { error: 'too large' }); req.destroy(); } else chunks.push(c); });
    req.on('end', async () => {
      if (res.writableEnded) return;
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, rpcError(null, -32700, 'Parse error')); }
      const list = Array.isArray(body) ? body : [body]; if (!list.length) return send(400, rpcError(null, -32600, 'Empty batch'));
      let out;
      try { out = (await dispatch(() => Promise.all(list.map(x => handle(x, actor))))).filter(Boolean); }
      catch { return send(401, { error: 'job run expired' }); }
      if (!out.length) return send(202, null);
      send(200, Array.isArray(body) ? out : out[0]);
    });
    req.on('error', () => {});
  }

  return {
    start(preferredPort = 0) {
      return new Promise((resolve, reject) => {
        const tryListen = p => { server = http.createServer(onRequest); server.requestTimeout = 180000; server.on('error', e => { if (e.code === 'EADDRINUSE' && p) { server.close(); tryListen(0); } else reject(e); }); server.listen(p, '127.0.0.1', () => { port = server.address().port; resolve(port); }); };
        tryListen(preferredPort);
      });
    },
    stop() { try { server && server.close(); } catch { /* already closed */ } server = null; },
    get port() { return port; },
    url(actor) { if (typeof actor !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(actor) || actor === 'commander' || actor === 'jarvis') throw new Error('The MCP address requires a worker identity.'); return `http://127.0.0.1:${port}/mcp/${actor}`; }
  };
}

module.exports = { createMcpServer, PROTOCOLS };
