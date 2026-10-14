'use strict';
// One connection from Orbit to an outside MCP server. Orbit makes this connection itself, so the service's token never reaches the crew.
// Uses the official MCP client library. Streamable HTTP first; the older SSE transport as a fallback.
const REQUIRED = '@modelcontextprotocol/sdk@1.30.0';
const { validateAgentId } = require('./neuralops-identity');
let SDK = null;
function sdk() {
  if (SDK) return SDK;
  try { SDK = { Client: require('@modelcontextprotocol/sdk/client/index.js').Client, Http: require('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport, Sse: require('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransport }; }
  catch { const e = new Error(`The MCP library is not installed. In the Orbit folder run: npm install ${REQUIRED}`); e.code = 'NO_SDK'; throw e; }
  return SDK;
}

// A short, plain reason for a failure (no addresses, no tokens).
function why(e) {
  const m = String((e && e.message) || e || ''), code = (e && (e.code || e.status)) || (/\b(401|403|404|429|5\d\d)\b/.exec(m) || [])[1];
  if (String(code) === '401' || /unauthorized/i.test(m)) return 'The service refused the token (401). Check that it is right and has not expired.';
  if (String(code) === '403' || /forbidden/i.test(m)) return 'The token is valid but not allowed to do that (403). Check its permissions.';
  if (String(code) === '404') return 'Nothing answers at that address (404).';
  if (String(code) === '429') return 'The service says too many requests (429). Try again in a minute.';
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return 'That address could not be found. Check it, and your internet.';
  if (/ECONNREFUSED|ECONNRESET|fetch failed/i.test(m)) return 'The service could not be reached.';
  if (/timed? ?out|timeout|aborted/i.test(m)) return 'The service took too long to answer.';
  return m.replace(/https?:\/\/\S+/g, '').replace(/Bearer\s+\S+/gi, 'Bearer ***').replace(/\s+/g, ' ').trim().slice(0, 160) || 'The connection failed.';
}

class Upstream {
  constructor({ id, url, token, agentId = null, timeoutMs = 90000 }) { this.id = id; this.url = url; this.token = token || ''; this.agentId = agentId === null ? null : validateAgentId(agentId); this.timeoutMs = timeoutMs; this.client = null; this.connecting = null; this.lastUse = Date.now(); this.controllers = new Set(); }
  get connected() { return !!this.client; }
  headers() { return { ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}), ...(this.agentId ? { 'X-Agent-Id': this.agentId } : {}) }; }
  async connect() {
    if (this.client) return this.client; if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const { Client, Http, Sse } = sdk(), init = { headers: this.headers() }; let lastErr;
      for (const T of [Http, Sse]) {
        const client = new Client({ name: 'orbit-gateway', version: '1.0.0' }, { capabilities: {} });
        try { await client.connect(new T(new URL(this.url), { requestInit: init }), { timeout: 30000 }); client.onclose = () => { if (this.client === client) this.client = null; }; client.onerror = () => {}; this.client = client; return client; }
        catch (e) { lastErr = e; try { await client.close(); } catch { /* not open */ } if (/401|403|Unauthorized|Forbidden/i.test(String(e && e.message)) || (e && (e.code === 401 || e.code === 403))) break; }   // a refused token will not work with another transport either
      }
      throw new Error(why(lastErr));
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async listTools() {
    const c = await this.connect(), out = []; let cursor;
    for (let page = 0; page < 20; page++) { const r = await c.listTools(cursor ? { cursor } : {}, { timeout: 30000 }); out.push(...(r.tools || [])); cursor = r.nextCursor; if (!cursor) break; }
    this.lastUse = Date.now(); return out.map(t => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || { type: 'object', properties: {} }, annotations: t.annotations || {} }));
  }
  // A dropped response may follow a completed write. Never automatically replay a tool invocation.
  async callTool(name, args, { timeoutMs, assertCurrent = () => {} } = {}) {
    const ctl = new AbortController(); this.controllers.add(ctl);
    try {
      const c = await this.connect();
      if (ctl.signal.aborted) throw new Error('Stopped by the user.');
      assertCurrent();
      try { const r = await c.callTool({ name, arguments: args || {} }, undefined, { timeout: timeoutMs || this.timeoutMs, signal: ctl.signal }); this.lastUse = Date.now(); return r; }
      catch (e) { if (ctl.signal.aborted) throw new Error('Stopped by the user.'); throw new Error(why(e) + ' The action outcome may be unknown. Inspect the service before retrying; Orbit did not replay this call.'); }
    } finally { this.controllers.delete(ctl); }
  }
  abort() { for (const c of this.controllers) try { c.abort(); } catch { /* done */ } }
  async close() { this.abort(); const c = this.client; this.client = null; if (c) { try { await c.close(); } catch { /* closed */ } } }
}

module.exports = { Upstream, why, sdk, REQUIRED };

