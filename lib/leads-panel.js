'use strict';
// The Leads screen's side of the app.
const { Leads, STATUSES } = require('./leads');

function register({ ipcMain, home, win, note = () => {} }) {
  const fromApp = e => { const w = win(); return !w || e.sender === w.webContents; };
  const guard = fn => async (e, ...a) => { if (!fromApp(e)) return { ok: false, error: 'not allowed' }; try { return { ok: true, ...(await fn(...a)) }; } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } };
  const L = new Leads(home);
  ipcMain.handle('leads:list', guard(o => ({ leads: L.list(o || {}), counts: L.counts(), statuses: STATUSES })));
  ipcMain.handle('leads:search', guard((q, limit) => ({ leads: L.search(String(q || ''), { limit: limit || 20 }) })));
  ipcMain.handle('leads:get', guard(id => { const l = L.get(id); if (!l) throw new Error('No such lead.'); return { lead: l }; }));
  ipcMain.handle('leads:add', guard(o => { const l = L.add(o || {}); note('leads', l.id, 'ok', `added ${l.name}`); return { lead: l, counts: L.counts() }; }));
  ipcMain.handle('leads:update', guard((id, patch) => { const l = L.update(id, patch || {}); note('leads', id, 'ok', `updated ${l.name}`); return { lead: l, counts: L.counts() }; }));
  ipcMain.handle('leads:note', guard((id, text) => ({ lead: L.addNote(id, text) })));
  ipcMain.handle('leads:remove', guard(id => { const l = L.get(id); L.remove(id); note('leads', id, 'ok', `removed ${l && l.name}`); return { counts: L.counts() }; }));
}

module.exports = { register };
