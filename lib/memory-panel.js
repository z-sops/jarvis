'use strict';
// The Memory screen's side of the app: read and change Laila's notes, skills and the way she addresses you. Plain files on disk, nothing hidden.
const fs = require('fs');
const path = require('path');
const { Notes, Skills, addressLine } = require('./memory');

function register({ ipcMain, home, store, bus, shell, win, commander = 'jarvis' }) {
  const fromApp = e => { const w = win(); return !!w && e.sender === w.webContents && !!e.senderFrame && e.senderFrame === w.webContents.mainFrame; };
  const dir = () => home.agentDir(commander), notes = () => new Notes(path.join(dir(), 'brain', 'memory', 'notes.md')), skills = () => { const s = new Skills(path.join(dir(), 'skills')); s.seedStarters(); return s; };
  const guard = fn => async (e, ...a) => { if (!fromApp(e)) return { ok: false, error: 'not allowed' }; try { return { ok: true, ...(await fn(...a)) }; } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } };
  const files = () => { const out = []; const walk = (d, rel) => { let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of list) { if (out.length >= 300) return; const r = rel ? rel + '/' + e.name : e.name, full = path.join(d, e.name); if (e.isDirectory()) walk(full, r); else { try { const st = fs.statSync(full); out.push({ path: r, size: st.size, mtime: st.mtime.toISOString() }); } catch { /* gone */ } } } }; walk(dir(), ''); return out.sort((a, b) => a.path.localeCompare(b.path)); };
  const profile = () => { const c = store.get(); return { userName: c.userName || '', userTitle: c.userTitle || '', address: addressLine(c), aiName: c.aiName || '' }; };
  const changed = () => { try { bus.emit('profile:changed', profile()); } catch { /* optional */ } };

  ipcMain.handle('memory:get', guard(() => ({ profile: profile(), notes: notes().list(), skills: skills().list().map(s => ({ slug: s.slug, title: s.title, description: s.description })), files: files(), folder: dir() })));
  ipcMain.handle('memory:note:add', guard((text, pin) => { notes().add(text, { origin: 'user', ...(pin === undefined || pin === null ? {} : { pin: !!pin }) }); return { notes: notes().list() }; }));
  ipcMain.handle('memory:note:update', guard((id, patch) => { notes().update(+id, patch || {}, { origin: 'user' }); return { notes: notes().list() }; }));
  ipcMain.handle('memory:note:remove', guard(id => { notes().remove(+id); return { notes: notes().list() }; }));
  ipcMain.handle('memory:skill:get', guard(slug => { const s = skills().get(String(slug)); if (!s) throw new Error('No such skill.'); return { skill: s }; }));
  ipcMain.handle('memory:skill:save', guard(s => { const saved = skills().save(s || {}); return { skill: saved, skills: skills().list().map(x => ({ slug: x.slug, title: x.title, description: x.description })) }; }));
  ipcMain.handle('memory:skill:remove', guard(slug => { skills().remove(String(slug)); return { skills: skills().list().map(x => ({ slug: x.slug, title: x.title, description: x.description })) }; }));
  ipcMain.handle('memory:profile', guard(p => {
    p = p || {}; const name = String(p.userName == null ? store.get().userName : p.userName).trim().slice(0, 40), title = String(p.userTitle == null ? '' : p.userTitle).trim().slice(0, 24);
    if (!name) throw new Error('Your name cannot be empty.'); store.set({ userName: name, userTitle: title }); changed(); return { profile: profile() };
  }));
  const gfile = () => path.join(dir(), 'brain', 'glossary.json');
  const readGloss = () => { try { const v = JSON.parse(fs.readFileSync(gfile(), 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };
  const cleanGloss = list => { if (!Array.isArray(list)) throw new Error('Give a list.'); const out = [], seen = new Set(); for (const g of list.slice(0, 200)) { const heard = String(g && g.heard || '').trim().slice(0, 40), meant = String(g && g.meant || '').trim().slice(0, 60); if (!heard && !meant) continue; if (!heard || !meant) throw new Error('Each row needs both: what the microphone writes, and what you said.'); const k = heard.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push({ heard, meant }); } return out; };
  ipcMain.handle('memory:glossary:get', guard(() => ({ words: readGloss() })));
  ipcMain.handle('memory:glossary:set', guard(list => { const words = cleanGloss(list); fs.mkdirSync(path.dirname(gfile()), { recursive: true }); require('./managed-write').writeFileSync(gfile(), JSON.stringify(words, null, 1)); try { bus.emit('glossary:changed', { count: words.length }); } catch { /* optional */ } return { words }; }));
  ipcMain.handle('memory:open', guard(async () => { fs.mkdirSync(dir(), { recursive: true }); const r = await shell.openPath(dir()); if (r) throw new Error(r); return {}; }));
}

module.exports = { register };
