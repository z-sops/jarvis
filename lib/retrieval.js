'use strict';
// Search over passages of text, with no download, no API and no quota: chunking plus BM25 ranking. Works offline on any computer.
const STOP = new Set(('a an the and or of to in on at for from by with is are was were be been being it its this that these those as into about not no do does did done i you he she we they me my your our their them his her '
  + 'if then than so but also can could should would will just very more most some any all each other such own same too only how what when where which who whom why there here '
  + 'hai hain ka ki ke ko se mein me par pe aur ya yeh ye woh wo ho hoon hota hoti hote tha thi the kar karo kya nahin nahi bhi to toh hi mujhe mujhko tum tumhein aap mera meri mere hum').split(/\s+/));

// A light English stemmer, enough for audits = audit, ranking = rank, pages = page.
function stem(w) {
  if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && /(sses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);            // classes = class, boxes = box, watches = watch
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);              // pages = page, sites = site, files = file
  return w;
}
function tokenize(text) {
  const out = []; for (const raw of String(text == null ? '' : text).toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u)) { if (!raw || (raw.length < 2 && !/\d/.test(raw)) || STOP.has(raw)) continue; out.push(stem(raw)); }
  return out;
}

// Splits a text into passages: by headings first (each passage remembers its heading), then by paragraphs and sentences up to `max` characters, with a little overlap.
function chunkText(text, { max = 900, overlap = 120, min = 60 } = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n'), sections = []; let head = '', buf = [];
  const flush = () => { const t = buf.join('\n').trim(); if (t) sections.push({ heading: head, text: t }); buf = []; };
  for (const l of lines) { const m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l); if (m) { flush(); head = m[2].trim().slice(0, 120); buf.push(l); } else buf.push(l); }
  flush();
  const out = [];
  for (const s of sections) {
    const paras = s.text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean); let cur = '';
    const push = t => { t = t.trim(); if (t) out.push({ heading: s.heading, text: t }); };
    for (let p of paras) {
      while (p.length > max) { let cut = p.lastIndexOf('. ', max); if (cut < max * 0.5) cut = p.lastIndexOf(' ', max); if (cut < max * 0.3) cut = max; const piece = p.slice(0, cut + 1); if (cur && cur.length + piece.length > max) { push(cur); cur = ''; } cur += (cur ? '\n\n' : '') + piece; push(cur); cur = ''; p = p.slice(cut + 1).trimStart(); }
      if (cur && cur.length + p.length + 2 > max) { push(cur); cur = ''; }
      cur += (cur ? '\n\n' : '') + p;
    }
    push(cur);
  }
  // a passage that is too short to mean anything joins the one before it (when they share a heading)
  const merged = []; for (const c of out) { const last = merged[merged.length - 1]; if (last && c.text.length < min && last.heading === c.heading && last.text.length + c.text.length < max * 1.3) last.text += '\n\n' + c.text; else merged.push({ ...c }); }
  return merged;
}

class Index {
  constructor() { this.docs = new Map(); this.df = new Map(); this.total = 0; }
  add(id, text, meta = null) {
    if (this.docs.has(id)) this.remove(id); const toks = tokenize(text), tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    this.docs.set(id, { len: toks.length, tf, meta }); this.total += toks.length; for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
  }
  remove(id) { const d = this.docs.get(id); if (!d) return; this.total -= d.len; for (const t of d.tf.keys()) { const n = (this.df.get(t) || 1) - 1; if (n <= 0) this.df.delete(t); else this.df.set(t, n); } this.docs.delete(id); }
  get size() { return this.docs.size; }
  search(query, { k = 5, filter = null, boost = null } = {}) {
    const q = [...new Set(tokenize(query))]; if (!q.length || !this.docs.size) return [];
    const N = this.docs.size, avg = this.total / N || 1, K1 = 1.5, B = 0.75, scores = [];
    for (const [id, d] of this.docs) {
      if (filter && !filter(d.meta, id)) continue; let s = 0;
      for (const t of q) { const f = d.tf.get(t); if (!f) continue; const n = this.df.get(t) || 0, idf = Math.log(1 + (N - n + 0.5) / (n + 0.5)); s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / avg)))); }
      if (s > 0) { if (boost) s *= boost(d.meta) || 1; scores.push({ id, score: s, meta: d.meta }); }
    }
    scores.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)); return scores.slice(0, Math.max(1, Math.min(20, k)));
  }
}

// The part of a passage around the words that were searched for.
function snippet(text, query, width = 600) {
  const t = String(text || ''); if (t.length <= width) return t; const q = new Set(tokenize(query)); let best = 0, bestScore = -1;
  for (let i = 0; i < t.length; i += Math.floor(width / 4)) { const win = t.slice(i, i + width); let sc = 0; for (const w of tokenize(win)) if (q.has(w)) sc++; if (sc > bestScore) { bestScore = sc; best = i; } }
  const from = t.lastIndexOf(' ', best) > 0 && best > 0 ? t.lastIndexOf(' ', best) + 1 : best; return (from > 0 ? '\u2026' : '') + t.slice(from, from + width).trim() + (from + width < t.length ? '\u2026' : '');
}

module.exports = { tokenize, stem, chunkText, Index, snippet, STOP };
