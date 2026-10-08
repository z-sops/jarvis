'use strict';
// Topics: separate conversations, each with its own history. Plain JSON files: jarvis/topics/<id>.json
const fs = require('fs');
const path = require('path');

const MAX_MESSAGES = 500, ROLES = new Set(['user', 'ai']);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// Time stamps that never repeat, so "newest first" is always exact.
let lastStamp = 0; const stamp = () => { let n = Date.now(); if (n <= lastStamp) n = lastStamp + 1; lastStamp = n; return new Date(n).toISOString(); };
const cleanTitle = t => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, 60);

class Topics {
  constructor(dir, { legacyFile = null } = {}) { this.dir = dir; this.legacyFile = legacyFile; this.pointer = path.join(dir, 'current.txt'); }
  file(id) { if (!/^[a-z0-9]+$/.test(String(id))) throw new Error('No such topic.'); return path.join(this.dir, id + '.json'); }
  read(id) { try { return JSON.parse(fs.readFileSync(this.file(id), 'utf8')); } catch { return null; } }
  write(t) { fs.mkdirSync(this.dir, { recursive: true }); const f = this.file(t.id), tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(t)); fs.renameSync(tmp, f); return t; }
  ids() { try { return fs.readdirSync(this.dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)); } catch { return []; } }
  list() { return this.ids().map(id => this.read(id)).filter(Boolean).map(t => ({ id: t.id, title: t.title, updated: t.updated, count: t.messages.length })).sort((a, b) => b.updated.localeCompare(a.updated)); }
  create(title) { const now = stamp(), t = { id: newId(), title: cleanTitle(title) || 'New topic', created: now, updated: now, messages: [] }; this.write(t); this.setCurrent(t.id); return t; }
  // The first time: the old single conversation becomes the topic "General".
  ensure() {
    if (!this.ids().length) {
      const t = this.create('General'); if (this.legacyFile) { try { const old = JSON.parse(fs.readFileSync(this.legacyFile, 'utf8')); const msgs = []; for (const m of old) { const text = (m.parts || []).map(p => p.text || '').join('').trim(); if (text) msgs.push({ role: m.role === 'user' ? 'user' : 'ai', text: text.slice(0, 4000), t: t.created }); } t.messages = msgs.slice(-MAX_MESSAGES); this.write(t); } catch { /* no old conversation */ } }
    }
    let cur = ''; try { cur = fs.readFileSync(this.pointer, 'utf8').trim(); } catch { /* none yet */ }
    if (!cur || !this.read(cur)) { cur = this.list()[0].id; this.setCurrent(cur); } return cur;
  }
  current() { return this.ensure(); }
  setCurrent(id) { this.file(id); fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.pointer, id); }
  get(id) { const t = this.read(id); if (!t) throw new Error('No such topic.'); return t; }
  switchTo(id) { const t = this.get(id); this.setCurrent(id); return t; }
  rename(id, title) { const t = this.get(id), c = cleanTitle(title); if (!c) throw new Error('A topic needs a name.'); t.title = c; return this.write(t); }
  remove(id) {
    this.get(id); fs.unlinkSync(this.file(id)); const cur = (() => { try { return fs.readFileSync(this.pointer, 'utf8').trim(); } catch { return ''; } })();
    if (cur === id || !this.ids().length) { if (!this.ids().length) this.create('General'); else this.setCurrent(this.list()[0].id); } return this.current();
  }
  // Every message of the conversation goes to the current topic (voice and text alike).
  append(role, text, meta = {}) {
    if (!ROLES.has(role)) return null; const clean = String(text == null ? '' : text).trim().slice(0, 4000); if (!clean) return null;
    const t = this.get(this.current()), msg = { role, text: clean, t: new Date().toISOString() }; if (meta && Number.isFinite(meta.ms) && meta.ms >= 0 && meta.ms < 3.6e6) { msg.ms = Math.round(meta.ms); if (meta.first) msg.first = true; } t.messages.push(msg); if (t.messages.length > MAX_MESSAGES) t.messages = t.messages.slice(-MAX_MESSAGES);
    if (role === 'user' && /^(New topic)$/i.test(t.title) && t.messages.filter(m => m.role === 'user').length === 1) t.title = cleanTitle(clean.replace(/^@\w+\s*/, '').slice(0, 40)) || t.title;
    t.updated = stamp(); this.write(t); return t;
  }
  clearCurrent() { const t = this.get(this.current()); t.messages = []; t.updated = stamp(); return this.write(t); }
  // For the text brain: the last messages as Gemini turns (it needs the first one to be from the user).
  history(n = 40) {
    const msgs = this.get(this.current()).messages.slice(-n), out = []; for (const m of msgs) out.push({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] });
    while (out.length && out[0].role !== 'user') out.shift(); return out;
  }
  // For the voice brain: a short reminder of where this topic stands.
  recap(maxMsgs = 10, maxChars = 1800) {
    const t = this.get(this.current()), lines = t.messages.slice(-maxMsgs).map(m => `${m.role === 'user' ? 'User' : 'You'}: ${m.text.replace(/\s+/g, ' ').slice(0, 220)}`); let s = lines.join('\n'); if (s.length > maxChars) s = s.slice(-maxChars);
    return { title: t.title, text: s, count: t.messages.length };
  }
}

module.exports = { Topics };
