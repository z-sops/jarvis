'use strict';
// The crew inspector's side of the code sandbox.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const S = require('./sandbox');

const run = (cmd, args, ms = 30000) => new Promise(res => execFile(cmd, args, { timeout: ms, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (e, stdout, stderr) => res({ code: e ? (typeof e.code === 'number' ? e.code : -1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: e ? e.message : '', notFound: !!(e && e.code === 'ENOENT') })));

function register({ ipcMain, home, win, fsOpts, pickFolder, runner = run, note = () => {} }) {
  const fromApp = e => { const w = win(); return !w || e.sender === w.webContents; };
  const guard = fn => async (e, ...a) => { if (!fromApp(e)) return { ok: false, error: 'not allowed' }; try { return { ok: true, ...(await fn(...a)) }; } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } };
  const agentFile = id => { if (!/^[a-z0-9-]+$/.test(String(id))) throw new Error('No such crew member.'); return path.join(home.agentDir(id), 'agent.json'); };
  const load = id => { const f = agentFile(id); let a; try { a = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { throw new Error('No such crew member.'); } return { a, f }; };
  let cache = null;   // Docker is asked at most every 8 seconds
  const docker = async force => { if (!force && cache && Date.now() - cache.t < 8000) return cache.v; const v = await S.probeDocker(runner); cache = { t: Date.now(), v }; return v; };

  ipcMain.handle('sandbox:get', guard(async id => { const { a } = load(id), d = await docker(); return { sandbox: S.normalize(a.sandbox), docker: d, image: S.IMAGE, memChoices: S.MEM_CHOICES, output: home.p('workspace', a.id) }; }));
  ipcMain.handle('sandbox:set', guard(async (id, patch) => {
    const { a, f } = load(id), next = S.normalize(patch, a.sandbox);
    if (next.enabled && !next.folders.length) { /* a sandbox with no project folder is fine: it only has /output and its own scratch space */ }
    if (next.folders.length) { const c = S.checkFolders(next.folders, { ...fsOpts, appDir: fsOpts.appDir }); if (!c.ok) throw new Error(c.error); next.folders = c.roots; }
    if (next.enabled) { const d = await docker(true); if (!d.ok) throw new Error(`The sandbox cannot be switched on yet: ${d.error}`); }
    a.sandbox = next; require('./managed-write').writeFileSync(f, JSON.stringify(a, null, 2)); note('sandbox', a.id, 'ok', next.enabled ? `on: ${next.folders.length} folder(s), network ${next.network ? 'on' : 'off'}, ${next.memoryMB} MB` : 'off'); return { sandbox: next };
  }));
  ipcMain.handle('sandbox:test', guard(async id => { const { a } = load(id); const r = await S.testSandbox(runner, a, { ws: home.p('workspace', a.id) }); cache = null; return r; }));
  ipcMain.handle('sandbox:pick', guard(async () => { if (!pickFolder) throw new Error('Choosing a folder is not available.'); return { path: await pickFolder() }; }));
}

module.exports = { register, run };
