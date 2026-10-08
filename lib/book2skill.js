'use strict';
/*
  Book to skill: turns one markdown book into the shape the Orbit Library wants:
    SKILL.md (short: what the book is, and a list of what is in each part) and references/part-NN.md (the book itself, split at headings).
  The agent reads only the part it needs, so the skill stays cheap. No AI call: this is plain splitting, so it costs nothing and is fast.
  Orbit Library limits it keeps to: at most 20 extra files, each under 200000 characters, SKILL.md steps under 60000, description under 300.
*/
const MAX_FILES = 19, MAX_FILE = 150000, PIECE = 50000, MAX_BODY = 60000, MAX_DESC = 300;

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

// Splits at headings of level 1 and 2 (a # inside a code block is not a heading).
function sections(md) {
  const lines = md.split('\n'), out = []; let cur = { title: 'Start', lines: [] }, fence = false;
  for (const ln of lines) {
    if (/^\s*(```|~~~)/.test(ln)) fence = !fence;
    const h = !fence && /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(ln);
    if (h) { if (cur.lines.join('').trim()) out.push(cur); cur = { title: h[2].trim(), lines: [ln] }; }
    else cur.lines.push(ln);
  }
  if (cur.lines.join('').trim()) out.push(cur);
  return out.map(s => ({ title: s.title, text: s.lines.join('\n').trim() }));
}
// A section that is too long for one file is cut at blank lines (never inside a code block).
function cut(sec, max) {
  if (sec.text.length <= max) return [sec];
  const parts = []; let buf = [], len = 0, fence = false;
  for (const para of sec.text.split(/\n{2,}/)) {
    const f = (para.match(/^\s*(```|~~~)/gm) || []).length; const add = para.length + 2;
    if (len + add > max && buf.length && !fence) { parts.push(buf.join('\n\n')); buf = []; len = 0; }
    buf.push(para); len += add; if (f % 2) fence = !fence;
  }
  if (buf.length) parts.push(buf.join('\n\n'));
  // one giant block without blank lines: cut by size
  const flat = []; for (const p of parts) { if (p.length <= max) flat.push(p); else for (let i = 0; i < p.length; i += max) flat.push(p.slice(i, i + max)); }
  return flat.map((t, i) => ({ title: sec.title + (flat.length > 1 ? ` (part ${i + 1} of ${flat.length})` : ''), text: t }));
}

function convert(md, { title, name, description } = {}) {
  let text = String(md || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const fm = /^---\n[\s\S]*?\n---\n/.exec(text); if (fm) text = text.slice(fm[0].length);
  if (!text.trim()) throw new Error('The book is empty.');
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(text);
  const bookTitle = clip(title || (h1 && h1[1]) || 'Book', 80);
  const secs = sections(text).flatMap(s => cut(s, PIECE));
  const total = secs.reduce((n, s) => n + s.text.length + 2, 0);
  if (total > MAX_FILES * MAX_FILE) throw new Error(`This book is too big for one skill (${Math.round(total / 1000)} KB of text; the most is about ${Math.round(MAX_FILES * MAX_FILE / 1000)} KB). Split it into two books and convert each.`);
  // group the sections, in order, into at most MAX_FILES files
  let target = Math.max(20000, Math.ceil(total / MAX_FILES)), groups;
  for (;;) {
    groups = []; let g = null;
    for (const s of secs) { if (!g || (g.len + s.text.length > target && g.secs.length)) { g = { secs: [], len: 0 }; groups.push(g); } g.secs.push(s); g.len += s.text.length + 2; }
    if (groups.length <= MAX_FILES && groups.every(x => x.len <= MAX_FILE + 2)) break;
    target = Math.ceil(target * 1.15); if (target > MAX_FILE) { target = MAX_FILE; if (groups.length <= MAX_FILES) break; throw new Error('Could not fit this book into one skill. Split it into two books.'); }
  }
  const pad = n => String(n).padStart(2, '0');
  const files = {}, rows = [];
  groups.forEach((g, i) => {
    const rel = `references/part-${pad(i + 1)}.md`;
    files[rel] = g.secs.map(s => s.text).join('\n\n') + '\n';
    rows.push({ rel, kb: Math.max(1, Math.round(g.len / 1000)), heads: g.secs.map(s => s.title) });
  });
  const tops = [...new Set(secs.map(s => s.title.replace(/\s*\(part \d+ of \d+\)$/, '')))];
  const desc = clip(description || `Reference book "${bookTitle}". Use it when a job needs what this book says about: ${tops.slice(0, 12).join('; ')}.`, MAX_DESC);
  const body = [
    `# ${bookTitle}`, '',
    `This skill is a whole book, split into ${rows.length} part${rows.length > 1 ? 's' : ''}. Do not read all of it. Look at the contents below, pick the part that matches the job, and read only that part with the path argument (for example ${rows[0].rel}).`, '',
    '## Contents',
    ...rows.map(r => `- ${r.rel} (${r.kb} KB): ${clip(r.heads.join(' | '), 260)}`), '',
    '## How to use it',
    '1. Say in one line what you need from the book.',
    '2. Read only the part or parts whose contents match.',
    '3. Follow or quote what the book says, and tell the user which part you used. If the book does not cover it, say so instead of guessing.', ''
  ].join('\n');
  if (body.length > MAX_BODY) throw new Error('The contents list is too long.');
  const nm = clip(name || bookTitle, 60);
  return { name: nm, description: desc, body, files, parts: rows.length, chars: total };
}

module.exports = { convert, sections, MAX_FILES, MAX_FILE, MAX_BODY, MAX_DESC };
