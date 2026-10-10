'use strict';
// The main-process side of the Orbit Browser: creates the manager and its MCP server, connects them to the app's events,
// gives the crew their browser (Hermes profile settings), and answers the Browser screen.
const fs = require('fs');
const { BrowserManager } = require('./browser');
const { createMcpServer } = require('./browser-mcp');
const { loadActorKey, createActorAuth } = require('./gateway-auth');

const SERVER = 'orbit';   // the crew sees the tools as mcp_orbit_browser_open, mcp_orbit_browser_click, ...
const KEYS = ['browserApproval', 'browserAllowLocal', 'browserIsolation', 'orbitBrowserCrew', 'orbitDisableHermesBrowser'];

function create({ electron, home, getCfg, store, bus, ask, send, label, onNeedsUser, runs }) {
  if (!runs) throw new Error('Orbit Browser requires the shared job-run registry.');
  const diagnosticGeneration = require('crypto').randomUUID();
  const manager = new BrowserManager({ electron, home, getCfg, ask, actorName: label, assertCurrent: runs.assertCurrent });
  fs.mkdirSync(home.p('browser'), { recursive: true });
  // A fresh key path deliberately does not reuse the old shared .token, which profiles may know.
  const auth = createActorAuth({ key: loadActorKey(home.p('browser', '.actor-token-key')), isActiveActor: id => id === 'bridge-check' || home.getAgent(id)?.id === id, generationFor: id => id === 'bridge-check' ? diagnosticGeneration : runs.generationFor(id) });
  let gateway = null;
  const mcp = createMcpServer({ manager, authenticate: auth.authenticate, bindRequest: actor => actor === 'bridge-check' ? fn => fn() : runs.bind(actor), assertCurrent: runs.assertCurrent, actorName: label, extra: { list: a => (a === 'bridge-check' ? [] : gateway ? gateway.list(a) : []), call: (a, n, args) => (gateway ? gateway.call(a, n, args) : { content: [{ type: 'text', text: 'The gateway is not running.' }], isError: true }) } });
  let connectors = null; const setConnectors = c => { connectors = c; }; const setGateway = g => { gateway = g; };
  let timer = null; const pushState = () => { if (timer) return; timer = setTimeout(() => { timer = null; send('browser:state', manager.state()); }, 120); };
  manager.on('state', pushState);
  manager.on('activity', e => { bus.emit('browser:action', e); send('browser:activity', e); });
  bus.on('stop:pressed', e => manager.cancelWaiting(e && e.agent));
  manager.on('handoff', h => { send('browser:handoff', h); if (onNeedsUser) onNeedsUser(h); });

  async function start() { const want = +getCfg().orbitMcpPort || 0; const port = await mcp.start(want); if (port !== want) { try { store.set({ orbitMcpPort: port }); } catch { /* the port is picked again next time */ } } return port; }
  // What one crew member's Hermes profile gets: the browser as an MCP server, and (once it is proven to work) Hermes' own browser switched off,
  // so nobody can open a normal Chrome. Returns text for the two places in config.yaml.
  function crewYaml(agent, { force = false } = {}) {
    const cfg = getCfg(); const out = { agent: '', top: '', env: [] }, lines = [];
    const orbitOn = mcp.port && (force || (!agent.connectorTest && cfg.orbitBrowserCrew !== false));
    if (orbitOn) {
      const actorToken = auth.tokenForActor(agent.id);
      if (!actorToken) throw new Error('Cannot prepare the Orbit gateway profile for an unknown, reserved or inactive worker identity.');
      if (cfg.orbitDisableHermesBrowser && !force) out.agent = '  disabled_toolsets:\n    - browser\n';
      lines.push(`  ${SERVER}:`, `    url: "${mcp.url(agent.id)}"`, '    headers:', '      Authorization: "Bearer ${ORBIT_GATEWAY_ACTOR_TOKEN}"', '    timeout: 150', '    connect_timeout: 30');
      out.env.push(`ORBIT_GATEWAY_ACTOR_TOKEN=${actorToken}`);
      if (force) out.agent = '  disabled_toolsets:\n    - browser\n';
    }
    if (lines.length) out.top = 'mcp_servers:\n' + lines.join('\n') + '\n';
    return out;
  }
  // Asks Hermes itself to connect to the browser, the same way a crew member would.
  async function crewCheck(hermes) {
    const steps = []; const add = (name, ok, detail) => { steps.push({ name, ok, detail: detail || '' }); return ok; };
    if (!hermes) return { ok: false, steps: [{ name: 'Crew engine', ok: false, detail: 'The crew is not set to use Hermes (Settings > Crew engine).' }] };
    const d = await hermes.detect(); if (!add('Hermes found', d.ok, d.ok ? d.version : `${d.error} ${d.hint || ''}`)) return { ok: false, steps };
    if (!mcp.port) { try { await start(); } catch (e) { add('Browser link starts', false, e.message); return { ok: false, steps }; } } add('Browser link starts', true, `Listening on this computer only (port ${mcp.port})`);
    const probe = { id: 'bridge-check', name: 'Orbit check', role: 'Self test', forceBrowser: true };
    try { await hermes.ensureProfile(probe); hermes.writeProfile(probe, 0); add('Profile prepared', true); } catch (e) { add('Profile prepared', false, e.message); return { ok: false, steps }; }
    const r = await hermes.run(['-p', probe.id, 'mcp', 'test', SERVER], { timeout: 120000 }), out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const tools = /Tools discovered:\s*(\d+)/i.exec(out), ok = /Connected/i.test(out) && !/Connection failed/i.test(out) && !!tools && +tools[1] > 0;
    add('Hermes connects to the Orbit Browser', ok, ok ? `${tools[1]} browser tools available to the crew` : (/mcp package|not installed|No module|ModuleNotFound|requires HTTP transport/i.test(out) ? 'This Hermes has no (or an old) MCP support: its "mcp" Python package is missing. Tell Claude and it will give you the one command to install it.' : (out.split('\n').map(l => l.trim()).filter(l => /fail|error|✗/i.test(l))[0] || out.trim().slice(-200) || 'No answer')));
    if (ok) { try { store.set({ orbitBrowserCrew: true, orbitDisableHermesBrowser: true }); add('Crew switched to the Orbit Browser', true, 'Hermes\'s own browser is now off for the crew, so nobody opens a normal Chrome.'); } catch { /* settings are still fine */ } }
    return { ok, steps };
  }
  function dispose() { try { mcp.stop(); } catch { /* stopped */ } manager.dispose(); }
  function containedEndpoint(agent){
    if(!mcp.port||getCfg().orbitBrowserCrew===false)return null;
    const token=auth.tokenForActor(agent.id);if(!token)throw Error('Native gateway requires an active worker run.');
    return {url:mcp.url(agent.id),token};
  }
  return { manager, mcp, start, crewYaml, crewCheck, dispose, setConnectors, setGateway, containedEndpoint };
}

function register({ ipcMain, browser, store, hermes, win }) {
  const m = browser.manager, fromApp = e => { const w = win(); return !w || e.sender === w.webContents; };
  const guard = fn => async (e, ...a) => { if (!fromApp(e)) return { ok: false, error: 'not allowed' }; try { return { ok: true, ...(await fn(...a)) }; } catch (err) { return { ok: false, error: err.message }; } };
  const settings = () => { const c = store.get(); return { browserApproval: c.browserApproval === 'strict' ? 'strict' : 'sensitive', browserAllowLocal: !!c.browserAllowLocal, browserIsolation: c.browserIsolation === 'per-agent' ? 'per-agent' : 'shared', orbitBrowserCrew: c.orbitBrowserCrew !== false, orbitDisableHermesBrowser: !!c.orbitDisableHermesBrowser }; };
  ipcMain.handle('browser:state', guard(() => ({ state: m.state(), activity: m.recent.slice(-80), settings: settings(), mcpPort: browser.mcp.port })));
  ipcMain.handle('browser:watch', guard(ctx => { m.setViewer(ctx || null, f => { const w = win(); if (w && !w.isDestroyed()) w.webContents.send('bus', { type: 'browser:frame', payload: f }); }); return {}; }));
  ipcMain.handle('browser:nav', guard(async (ctx, input) => m.userNavigate(ctx, input)));
  ipcMain.handle('browser:tab', guard((ctx, action, id) => ({ done: m.userTab(ctx, action, id) })));
  ipcMain.handle('browser:takeover', guard((ctx, on) => ({ done: m.takeover(ctx, !!on) })));
  ipcMain.handle('browser:resume', guard((ctx, done) => ({ done: m.resume(ctx, !!done) })));
  ipcMain.handle('browser:input', (e, ctx, evt) => (fromApp(e) ? m.input(ctx, evt) : { ok: false }));
  ipcMain.handle('browser:clear', guard(async ctx => ({ done: await m.clearData(ctx) })));
  ipcMain.handle('browser:settings', guard(patch => { const clean = {}; for (const k of KEYS) if (patch && k in patch) clean[k] = k === 'browserApproval' ? (patch[k] === 'strict' ? 'strict' : 'sensitive') : k === 'browserIsolation' ? (patch[k] === 'per-agent' ? 'per-agent' : 'shared') : !!patch[k]; store.set(clean); return { settings: settings() }; }));
  ipcMain.handle('browser:crewCheck', guard(async () => browser.crewCheck(hermes)));
}

module.exports = { create, register, SERVER, KEYS };
