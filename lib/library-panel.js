'use strict';
// The Library screen's side of the app.
const { Library, htmlToText, fetchPage } = require('./library');
const { extractPdfText } = require('./pdf-extract');

function register({ ipcMain, home, win, listAgents, fetchPageFn = fetchPage, note = () => {} }) {
  const fromApp = e => { const w = win(); return !w || e.sender === w.webContents; };
  const guard = fn => async (e, ...a) => { if (!fromApp(e)) return { ok: false, error: 'not allowed' }; try { return { ok: true, ...(await fn(...a)) }; } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } };
  const lib = () => new Library(home);
  const overview = () => { const l = lib(); return { skills: l.skills(), packs: l.packs(), agents: [{ id: 'jarvis', name: 'Laila', role: 'Chief of staff' }, ...listAgents().map(a => ({ id: a.id, name: a.name, role: a.role }))], assignments: l.assignments() }; };
  ipcMain.handle('library:get', guard(() => overview()));
  ipcMain.handle('library:skill:get', guard(name => { const s = lib().skill(name); if (!s) throw new Error('No such skill.'); return { skill: s }; }));
  ipcMain.handle('library:skill:save', guard(s => { const r = lib().saveSkill(s || {}); note('library', 'skill', 'ok', 'saved ' + r.slug); return { skill: r, ...overview() }; }));
  ipcMain.handle('library:skill:remove', guard(name => { lib().removeSkill(name); note('library', 'skill', 'ok', 'deleted ' + name); return overview(); }));
  ipcMain.handle('library:pack:create', guard(p => { const r = lib().createPack(p || {}); return { pack: r, ...overview() }; }));
  ipcMain.handle('library:pack:remove', guard(name => { lib().removePack(name); note('library', 'pack', 'ok', 'deleted ' + name); return overview(); }));
  ipcMain.handle('library:sources', guard(name => ({ sources: lib().sources(name) })));
  ipcMain.handle('library:source:text', guard(({ pack, title, text, trust, reviewDays, origin } = {}) => { const r = lib().addSource(pack, { title, text, trust, reviewDays, origin: origin || { type: 'paste', ref: '' } }); note('library', pack, 'ok', `added "${r.source.title}" (${r.chunks} passages)`); return { added: r, sources: lib().sources(pack), ...overview() }; }));
  ipcMain.handle('library:source:file', guard(async ({ pack, name, text, dataBase64, trust, reviewDays } = {}) => {
    const fname = String(name || 'file').slice(0, 120);
    if (/\.pdf$/i.test(fname)) {
      if (!dataBase64) throw new Error('No file data was sent.'); let buf; try { buf = Buffer.from(String(dataBase64), 'base64'); } catch { throw new Error('That file could not be read.'); }
      if (buf.length > 60000000) throw new Error('That PDF is too big (over 60 MB).'); const pdf = await extractPdfText(buf); const title = pdf.title || fname.replace(/\.pdf$/i, '');
      const r = lib().addSource(pack, { title, text: pdf.text, trust, reviewDays, origin: { type: 'file', ref: fname } }); note('library', pack, 'ok', `added PDF ${fname}, ${pdf.pages} pages (${r.chunks} passages)`); return { added: r, sources: lib().sources(pack), ...overview() };
    }
    if (!/\.(md|markdown|txt|html?|json|csv)$/i.test(fname)) throw new Error('Files: .md, .txt, .html, .json, .csv or .pdf.');
    let body = String(text || ''), title = fname; if (/\.html?$/i.test(fname)) { const r = htmlToText(body); body = r.text; title = r.title || fname; }
    const r = lib().addSource(pack, { title, text: body, trust, reviewDays, origin: { type: 'file', ref: fname } }); note('library', pack, 'ok', `added file ${fname} (${r.chunks} passages)`); return { added: r, sources: lib().sources(pack), ...overview() };
  }));
  ipcMain.handle('library:source:url', guard(async ({ pack, url, trust, reviewDays } = {}) => { const page = await fetchPageFn(String(url || '')); const r = lib().addSource(pack, { title: page.title || page.url, text: page.text, trust, reviewDays, origin: { type: 'url', ref: page.url } }); note('library', pack, 'ok', `added page ${page.url} (${r.chunks} passages)`); return { added: r, sources: lib().sources(pack), ...overview() }; }));
  ipcMain.handle('library:source:remove', guard((pack, sid) => { lib().removeSource(pack, String(sid)); return { sources: lib().sources(pack), ...overview() }; }));
  ipcMain.handle('library:source:trust', guard((pack, sid, trust) => { lib().setSourceTrust(pack, String(sid), trust); return { sources: lib().sources(pack) }; }));
  ipcMain.handle('library:source:reviewed', guard((pack, sid) => { lib().markReviewed(pack, String(sid)); return { sources: lib().sources(pack) }; }));
  ipcMain.handle('library:search', guard((pack, query, trustedOnly) => ({ hits: lib().search(pack, String(query || ''), { k: 6, trustedOnly: !!trustedOnly }) })));
  ipcMain.handle('library:assign', guard((id, a) => { const r = lib().setAssignment(String(id), a || {}); note('library', 'assign', 'ok', `${id}: ${r.skills.length} skill(s), ${r.packs.length} pack(s)`); return { assignment: r, assignments: lib().assignments() }; }));
}

module.exports = { register };
