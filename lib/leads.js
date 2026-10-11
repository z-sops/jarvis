'use strict';
// A simple leads/CRM store: one business you might work with, its status in the pipeline, and a timestamped trail
// of notes. Kept as plain JSON files (one per lead) under leads/, same shape of storage as the rest of Orbit's own
// data, so no database dependency and every record is a file you could open yourself.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('./retrieval');

const STATUSES = ['new', 'researched', 'pitched', 'replied', 'negotiating', 'won', 'lost', 'archived'];
const LIM = { name: 140, field: 300, note: 4000, notes: 500, leads: 20000, tag: 30, tags: 15 };
const now = () => new Date().toISOString();
const clean = s => String(s == null ? '' : s).replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
const atomic = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; require('./managed-write').writeFileSync(tmp, text); fs.renameSync(tmp, file); };
const readJson = (file, dflt) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; } };

// A loose match for a public-looking email address; this never decides consent, only shapes the record.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class Leads {
  constructor(home) { this.home = home; this.root = home.p('leads'); this.idx = null; }
  p(...a) { return path.join(this.root, ...a); }
  file(id) { return this.p((id || '').slice(0, 2) || '_', id + '.json'); }

  list({ status, assignedTo, tag, doNotContact, limit } = {}) {
    const out = []; let dirs = []; try { dirs = fs.readdirSync(this.root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return out; }
    for (const d of dirs) { let files = []; try { files = fs.readdirSync(this.p(d)).filter(f => f.endsWith('.json')); } catch { continue; }
      for (const f of files) { const l = readJson(this.p(d, f), null); if (!l) continue;
        if (status && l.status !== status) continue; if (assignedTo != null && l.assignedTo !== assignedTo) continue; if (tag && !(l.tags || []).includes(tag)) continue; if (doNotContact != null && !!l.doNotContact !== !!doNotContact) continue;
        out.push(l);
      }
    }
    out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); return limit ? out.slice(0, Math.max(1, limit)) : out;
  }
  get(id) { return readJson(this.file(String(id || '')), null); }
  count() { let n = 0; try { for (const d of fs.readdirSync(this.root, { withFileTypes: true })) if (d.isDirectory()) { try { n += fs.readdirSync(this.p(d.name)).filter(f => f.endsWith('.json')).length; } catch { /* unreadable folder: skip */ } } } catch { /* no leads yet */ } return n; }   // names only: add() calls this every time

  add({ name, website, phone, email, city, industry, source, notes, tags, assignedTo } = {}) {
    const nm = clean(name); if (!nm) throw new Error('A lead needs at least a business name.'); if (nm.length > LIM.name) throw new Error('That name is too long.');
    if (this.count() >= LIM.leads) throw new Error('That is a lot of leads already.');
    const em = clean(email); if (em && !EMAIL_RE.test(em)) throw new Error('That does not look like an email address.');
    const id = 'ld' + crypto.randomBytes(6).toString('hex'), t = now();
    const lead = {
      id, name: nm, website: clean(website).slice(0, LIM.field), phone: clean(phone).slice(0, LIM.field), email: em.slice(0, LIM.field),
      city: clean(city).slice(0, LIM.field), industry: clean(industry).slice(0, LIM.field), source: clean(source).slice(0, LIM.field) || 'manual',
      status: 'new', doNotContact: false, assignedTo: assignedTo ? clean(assignedTo).slice(0, 40) : null,
      tags: [...new Set((Array.isArray(tags) ? tags : []).map(x => clean(x).slice(0, LIM.tag)).filter(Boolean))].slice(0, LIM.tags),
      notes: [], lastContactedAt: null, createdAt: t, updatedAt: t,
    };
    if (notes) lead.notes.push({ t, text: clean(notes).slice(0, LIM.note) });
    atomic(this.file(id), JSON.stringify(lead, null, 1)); this.idx = null; return lead;
  }
  update(id, patch = {}) {
    const l = this.get(id); if (!l) throw new Error('No such lead.');
    if (patch.status != null) { if (!STATUSES.includes(patch.status)) throw new Error(`Status must be one of: ${STATUSES.join(', ')}.`); l.status = patch.status; if (patch.status === 'pitched' || patch.status === 'replied') l.lastContactedAt = now(); }
    for (const k of ['name', 'website', 'phone', 'city', 'industry', 'source']) if (patch[k] != null) { const v = clean(patch[k]); if (k === 'name' && !v) throw new Error('A lead needs a name.'); l[k] = v.slice(0, k === 'name' ? LIM.name : LIM.field); }
    if (patch.email != null) { const v = clean(patch.email); if (v && !EMAIL_RE.test(v)) throw new Error('That does not look like an email address.'); l.email = v.slice(0, LIM.field); }
    if (patch.assignedTo !== undefined) l.assignedTo = patch.assignedTo ? clean(patch.assignedTo).slice(0, 40) : null;
    if (patch.doNotContact != null) l.doNotContact = !!patch.doNotContact;
    if (patch.tags != null) l.tags = [...new Set((Array.isArray(patch.tags) ? patch.tags : []).map(x => clean(x).slice(0, LIM.tag)).filter(Boolean))].slice(0, LIM.tags);
    l.updatedAt = now(); atomic(this.file(id), JSON.stringify(l, null, 1)); this.idx = null; return l;
  }
  addNote(id, text) {
    const l = this.get(id); if (!l) throw new Error('No such lead.'); const t = clean(text); if (!t) throw new Error('Say what to note.');
    l.notes.push({ t: now(), text: t.slice(0, LIM.note) }); if (l.notes.length > LIM.notes) l.notes = l.notes.slice(-LIM.notes); l.updatedAt = now();
    atomic(this.file(id), JSON.stringify(l, null, 1)); this.idx = null; return l;
  }
  remove(id) { const f = this.file(id); if (!fs.existsSync(f)) throw new Error('No such lead.'); fs.unlinkSync(f); this.idx = null; }

  // Search over names, notes, tags and other text fields, ranked; a business-do-not-contact lead is never hidden,
  // only marked, so a search cannot accidentally suggest contacting someone who should not be.
  index() {
    const leads = this.list(), sig = leads.map(l => l.id + ':' + l.updatedAt).join('|'); if (this.idx && this.idx.sig === sig) return this.idx;
    const ix = new R.Index(); for (const l of leads) ix.add(l.id, [l.name, l.website, l.city, l.industry, l.source, ...(l.tags || []), ...l.notes.map(n => n.text)].filter(Boolean).join('\n'), l);
    return (this.idx = { sig, ix, byId: new Map(leads.map(l => [l.id, l])) });
  }
  search(query, { limit = 10 } = {}) { const c = this.index(); return c.ix.search(query, { k: Math.max(1, Math.min(30, limit)) }).map(r => c.byId.get(r.id)); }

  counts() { const c = Object.fromEntries(STATUSES.map(s => [s, 0])); for (const l of this.list()) c[l.status] = (c[l.status] || 0) + 1; return c; }
}

module.exports = { Leads, STATUSES };
