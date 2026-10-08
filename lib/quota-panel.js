'use strict';
// The window side of the quota meter: the limits table, the models the key can use, switching the everyday model, and the warnings.
const fs = require('fs');
const Q = require('./quota');

function register({ ipcMain, home, usage, store, send, win, listFn = Q.listModels }) {
  const fromApp = e => { const w = win(); return !w || e.sender === w.webContents; };
  const guard = fn => async (e, ...a) => { if (!fromApp(e)) return { ok: false, error: 'not allowed' }; try { return { ok: true, ...(await fn(...a)) }; } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } };
  const file = () => home.p('usage-limits.json');
  ipcMain.handle('quota:limits', guard(() => ({ limits: Q.loadLimits(file()), defaults: Q.DEFAULT_LIMITS })));
  ipcMain.handle('quota:setLimits', guard(list => ({ limits: Q.saveLimits(file(), list) })));
  ipcMain.handle('quota:resetLimits', guard(() => { try { fs.unlinkSync(file()); } catch { /* there was no file */ } return { limits: Q.DEFAULT_LIMITS }; }));
  ipcMain.handle('quota:models', guard(async () => { const cfg = store.get(); const r = await listFn(cfg, Q.loadLimits(file())); return { ...r, current: { text: cfg.textModel, live: cfg.liveModel }, limits: Q.loadLimits(file()) }; }));
  ipcMain.handle('quota:setText', guard(id => { if (!Q.validModelId(id)) throw new Error('That is not a Gemini model name.'); store.set({ textModel: id }); return { text: id }; }));
  const watch = Q.createWatcher({ day: () => usage.snapshot().day, emit: e => send('quota:warn', e) });
  usage.onChange(() => { try { const c = store.get(); watch(Q.view(usage.snapshot(), Q.loadLimits(file()), { focus: [c.textModel] })); } catch { /* a warning that cannot be worked out is not worth a crash */ } });
}

module.exports = { register };
