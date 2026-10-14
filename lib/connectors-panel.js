'use strict';
// The Connectors screen's side of the app: add, test, change and remove connectors, and set what the crew may do (free, ask, blocked).
// The page can save a token but never read one back.
const { checkSpec, publicCatalog, isReadTool, NATIVE_TOOLS } = require('./connectors');
const { checkRoots } = require('./fsmcp');

function register({ ipcMain, connectors, gateway, store, bus, send, win, fsOpts = {}, pickFolder = null, workerIds = () => [] }) {
  const fromApp = e => { const w = win(); return !w || e.sender === w.webContents; };
  const recent = [];
  if (bus && bus.on) bus.on('connector:action', e => { const x = { ...e, t: Date.now() }; recent.push(x); if (recent.length > 60) recent.shift(); if (send) send('connector:activity', x); });
  const note = (action, id, status, detail) => { try { bus.emit('connector:action', { action, id, status, detail }); } catch { /* the log is optional */ } };
  let chain = Promise.resolve(); const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  const view = c => ({ id: c.id, name: c.name, catalogId: c.catalogId, native: c.native || null, roots: c.roots || [], url: c.url, auth: c.auth, mode: c.mode, enabled: !!c.enabled, agents: c.agents, lastTest: c.lastTest || null, hasToken: !!connectors.token(c.id),
    neuralopsIdentities: c.catalogId === 'neuralops' ? c.neuralopsIdentities || {} : undefined,
    tools: (c.tools || []).map(n => ({ name: n, read: isReadTool(n), level: (c.levels || {})[n] || 'blocked', desc: (c.desc || {})[n] || '' })) });
  const nativeView = () => { const l = connectors.nativeLevels(); return NATIVE_TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, level: l[t.name] })); };
  const guard = fn => async (e, ...a) => { if (!fromApp(e)) return { ok: false, error: 'not allowed' }; try { return { ok: true, ...(await fn(...a)) }; } catch (err) { return { ok: false, error: String((err && err.message) || err).replace(/(Bearer\s+)\S+/gi, '$1***') }; } };

  // Orbit connects to the service itself, lists its tools, and remembers them. The first successful test switches the connector on.
  function test(id) {
    return serial(async () => {
      const c = connectors.get(id); if (!c) throw new Error('No such connector.');
      const r = await gateway.test(id);
      if (r.ok) { const first = !(c.lastTest && c.lastTest.ok); connectors.applyTools(id, r.tools); note('tested', id, 'ok', `${r.count} tools offered`); if (first) { connectors.update(id, { enabled: true }); note('enabled', id, 'ok', c.mode === 'read-write' ? 'read, and ask before changes' : 'read only'); } }
      else { connectors.update(id, { lastTest: { ok: false, at: new Date().toISOString(), error: r.error || 'No answer' } }); note('tested', id, 'error', r.error || 'No answer'); }
      return { test: { ok: r.ok, count: r.count, error: r.error }, connector: view(connectors.get(id)) };
    });
  }

  ipcMain.handle('connectors:list', guard(() => ({ catalog: publicCatalog(), connectors: connectors.list().map(view), native: nativeView(), engine: store.get().engine === 'hermes' ? 'hermes' : 'builtin', recent: recent.slice(-40) })));
  ipcMain.handle('connectors:add', guard(async spec => {
    const c = checkSpec(spec, { allowInsecureLocal: connectors.allowInsecureLocal, fsOpts }); if (!c.ok) throw new Error(c.error);
    connectors.add(c); note('added', c.id, 'ok', `${c.name} (${c.mode === 'read-write' ? 'read, ask before changes' : 'read only'})`);
    const r = await test(c.id).catch(err => ({ test: { ok: false, error: err.message }, connector: view(connectors.get(c.id)) }));
    return { connector: r.connector, test: r.test, warn: c.warn };
  }));
  ipcMain.handle('connectors:test', guard(id => test(String(id))));
  ipcMain.handle('connectors:verifyIdentities', guard(async id => {
    const verification = await require('./neuralops-identity').verifyIdentities(connectors, String(id), workerIds());
    note('identity verification', String(id), verification.allPassed ? 'ok' : 'error', verification.stale ? 'configuration changed; check again' : verification.allPassed ? 'broker and worker identities verified' : 'identity verification incomplete; inspect worker results');
    return { verification };
  }));
  ipcMain.handle('connectors:update', guard(async (id, patch) => {
    id = String(id); const c = connectors.get(id); if (!c) throw new Error('No such connector.'); patch = patch || {};
    if ('neuralopsIdentities' in patch) { connectors.setNeuralopsIdentities(id, patch.neuralopsIdentities); await gateway.close(id); note('identities', id, 'ok', 'worker identity mappings updated'); }
    if ('mode' in patch) { const m = patch.mode === 'read-write' ? 'read-write' : 'read-only'; if (m !== c.mode) { connectors.setMode(id, m); await gateway.close(id); note('mode', id, 'ok', m === 'read-write' ? 'now: read, and ask before changes' : 'now: read only'); } }
    if ('enabled' in patch) { connectors.update(id, { enabled: !!patch.enabled }); if (!patch.enabled) await gateway.close(id); note(patch.enabled ? 'enabled' : 'disabled', id, 'ok', ''); }
    if ('agents' in patch) connectors.update(id, { agents: patch.agents === 'all' ? 'all' : (Array.isArray(patch.agents) ? patch.agents.map(x => String(x).slice(0, 40)).slice(0, 50) : 'all') });
    return { connector: view(connectors.get(id)) };
  }));
  ipcMain.handle('connectors:level', guard((id, tool, level) => { id = String(id); connectors.setLevel(id, String(tool), String(level)); note('level', id, 'ok', `${tool}: ${level}`); return { connector: view(connectors.get(id)) }; }));
  ipcMain.handle('connectors:native', guard((tool, level) => { connectors.setNativeLevel(String(tool), String(level)); note('level', 'orbit', 'ok', `${tool}: ${level}`); return { native: nativeView() }; }));
  ipcMain.handle('connectors:roots', guard(async (id, roots) => {
    id = String(id); const c = connectors.get(id); if (!c || !c.native) throw new Error('This connector has no folders.');
    const r = checkRoots(roots, fsOpts); if (!r.ok) throw new Error(r.error);
    connectors.setRoots(id, r.roots); await gateway.close(id); note('folders', id, 'ok', r.roots.join(', ')); return test(id);
  }));
  ipcMain.handle('connectors:pickFolder', guard(async () => { if (!pickFolder) throw new Error('Choosing a folder is not available.'); return { path: await pickFolder() }; }));
  ipcMain.handle('connectors:token', guard(async (id, token) => {
    id = String(id); const c = connectors.get(id); if (!c) throw new Error('No such connector.'); if (c.native) throw new Error('This connector has no token.');
    const chk = checkSpec({ catalogId: c.catalogId, name: c.id, url: c.url, token, mode: c.mode, options: c.options }, { allowInsecureLocal: connectors.allowInsecureLocal }); if (!chk.ok) throw new Error(chk.error);
    connectors.setToken(id, chk.token); await gateway.close(id); note('token', id, 'ok', 'token replaced'); return test(id);
  }));
  ipcMain.handle('connectors:remove', guard(async id => { id = String(id); await gateway.close(id); connectors.remove(id); note('removed', id, 'ok', ''); return {}; }));
}

module.exports = { register };

