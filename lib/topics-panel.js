'use strict';
// The chat screen's side of Topics.
const { Topics } = require('./topics');
function register({ ipcMain, home, win }) {
  const fromApp = e => { const w = win(); return !w || e.sender === w.webContents; };
  const T = () => home.topics();
  const guard = fn => async (e, ...a) => { if (!fromApp(e)) return { ok: false, error: 'not allowed' }; try { return { ok: true, ...(await fn(...a)) }; } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } };
  const state = () => { const t = T(), cur = t.current(); return { topics: t.list(), current: cur, messages: t.get(cur).messages }; };
  ipcMain.handle('topics:state', guard(() => state()));
  ipcMain.handle('topics:switch', guard(id => ({ topic: T().switchTo(String(id)) })));
  ipcMain.handle('topics:create', guard(title => ({ topic: T().create(title) })));
  ipcMain.handle('topics:rename', guard((id, title) => { T().rename(String(id), title); return {}; }));
  ipcMain.handle('topics:remove', guard(id => ({ current: T().remove(String(id)) })));
  ipcMain.handle('topics:append', guard((role, text, meta) => { T().append(String(role), text, meta && typeof meta === 'object' ? { ms: meta.ms, first: !!meta.first } : {}); return {}; }));
}
module.exports = { register, Topics };
