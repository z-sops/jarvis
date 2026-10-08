/* The chat, made better: Markdown answers with Copy buttons, @mention of crew members, @chart, Quick Run buttons, Topics, the start-up checklist. */
(() => {
  'use strict';
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return el; };
  const $ = s => document.querySelector(s);
  const S = { cfg: {}, crew: [], topics: [], cur: '', ready: false };

  /* ---------- the time on every line, and how long the answer took ---------- */
  const pad = n => String(n).padStart(2, '0');
  const clock = d => { const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; return d.toDateString() === new Date().toDateString() ? t : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${t}`; };
  const fmtMs = ms => { const s = ms / 1000; if (s < 10) return s.toFixed(1) + ' s'; if (s < 60) return Math.round(s) + ' s'; const m = Math.floor(s / 60); return `${m} min ${Math.round(s - m * 60)} s`; };
  let lastUserAt = 0, lastHeard = 0, lastLoud = 0, floor = 0.03;   // when you last sent a message / when your voice was last transcribed / when the microphone last heard you
  // The microphone level, straight from the voice session: the last moment it was clearly louder than the room is when you stopped talking.
  // (The transcript arrives late, often together with the answer, so it cannot say when you stopped.) Ignored while she is speaking, so her own voice does not count.
  function level(p, vstate) { if (!p || !('mic' in p) || vstate === 'speaking') return; const v = +p.mic || 0; if (!v) return; floor = Math.min(v, floor + 0.0004); if (v > Math.max(0.06, floor * 3)) lastLoud = Date.now(); }
  const script = text => { if (!window.Translit) return text; const t = Translit.has(text) ? Translit.toRoman(text) : text; return Translit.applyGlossary(t); };   // Devanagari to Roman letters, then your own list (ji = Zee)
  const loadGlossary = () => bridge.memory.glossaryGet().then(r => { if (r.ok && window.Translit) Translit.setGlossary(r.words); }).catch(() => {});
  const syncNames = () => { if (window.Translit) Translit.setNames([S.cfg.aiName, S.cfg.userName, ...S.crew.map(a => a.name)]); };   // your name, hers and the crew's are written the way they are spelled
  function stamp(el, when, lat) {
    let sm = el.querySelector('small'); if (!sm) { sm = h('small', {}); el.insertBefore(sm, el.firstChild); }
    if (!sm.querySelector('time')) sm.append(sm.textContent ? ' ' : '', h('time', { class: 'msg-time', datetime: when.toISOString(), title: when.toLocaleString() }, clock(when)));
    if (lat) { let l = sm.querySelector('.msg-lat'); if (!l) { l = h('span', { class: 'msg-lat' }); sm.append(l); } l.textContent = ' \u00B7 ' + lat; }
  }
  // Called for every piece of speech the voice hears: the last one before the answer starts is the end of what you said.
  function heard(role) { if (role === 'user') { lastHeard = Date.now(); lastUserAt = 0; } }

  /* ---------- Markdown answers (the same safe renderer as the Workspace: it builds elements, never HTML) ---------- */
  function body(text) {
    const box = h('div', { class: 'md md-chat' }, ...(window.__md ? window.__md(text) : [h('p', {}, text)]));
    for (const pre of box.querySelectorAll('pre.md-code')) { const wrap = h('div', { class: 'md-codewrap' }); pre.replaceWith(wrap); const btn = h('button', { class: 'md-copy', type: 'button', 'aria-label': 'Copy the code', onclick: async () => { try { await navigator.clipboard.writeText(pre.textContent); btn.textContent = 'Copied'; } catch { btn.textContent = 'Could not copy'; } setTimeout(() => (btn.textContent = 'Copy'), 1600); } }, 'Copy'); wrap.append(btn, pre); }
    return box;
  }
  document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('#log a.md-a'); if (!a) return; e.preventDefault(); const u = a.getAttribute('data-url'); if (/^https?:\/\//i.test(u) && confirm('Open this link in your browser?\n\n' + u)) bridge.openExternal(u); });

  /* ---------- @mentions ---------- */
  const names = () => { const seen = new Set(), crew = []; for (const a of S.crew) { const k = String(a.name || '').toLowerCase(); if (!k || k === 'chart' || seen.has(k)) continue; seen.add(k); crew.push({ key: a.name, id: a.id, role: a.role || 'Crew', kind: 'crew' }); } return [...crew, { key: 'chart', id: 'chart', role: 'Draw a chart from real numbers', kind: 'chart' }]; };   // two members with the same name: the first one gets the tag
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function mentionsIn(text) {
    const found = []; for (const n of names()) { const m = new RegExp('(^|\\s)@' + escRe(n.key) + '(?=$|[\\s.,;:!?])', 'i').exec(text); if (m) found.push({ n, at: m.index }); } return found.sort((a, b) => a.at - b.at).map(x => x.n);   // in the order you wrote them
  }
  function mentionNodes(text) {
    const list = names().map(n => escRe(n.key)); if (!list.length) return [text]; const re = new RegExp('(^|\\s)(@(?:' + list.join('|') + '))(?=$|[\\s.,;:!?])', 'gi'), out = []; let i = 0, m;
    while ((m = re.exec(text))) { const start = m.index + m[1].length; if (start > i) out.push(text.slice(i, start)); out.push(h('span', { class: 'mention' }, m[2])); i = start + m[2].length; }
    if (i < text.length) out.push(text.slice(i)); return out;
  }
  // What Laila receives: the words you typed, with a short note in front when you tagged someone.
  function outgoing(text) {
    const found = mentionsIn(text), crew = found.filter(n => n.kind === 'crew'), chart = found.some(n => n.kind === 'chart'), notes = [];
    if (crew.length) notes.push(`[The user tagged ${crew.map(n => `@${n.key} (agent id: ${n.id})`).join(' and ')}. Give this job to ${crew.length > 1 ? 'each of them' : crew[0].key} with assign_task right away. Do not ask "me or ${crew[0].key}?".]`);
    if (chart) notes.push('[The user tagged @chart: they want a chart. Get real numbers first (web_search, a file, the crew or the user), then call make_chart. Never invent numbers; say in one sentence where they came from.]');
    return notes.length ? notes.join('\n') + '\n' + text : text;
  }
  const input = () => $('#msg');
  let pop = null, popIdx = 0, popItems = [];
  function tokenAtCaret() { const i = input(); const before = i.value.slice(0, i.selectionStart), m = /(^|\s)@([\w-]*)$/.exec(before); return m ? { q: m[2], start: before.length - m[2].length - 1 } : null; }
  function closePop() { if (pop) { pop.remove(); pop = null; } popItems = []; }
  function pick(n) { const i = input(), t = tokenAtCaret(); if (!t) return closePop(); const after = i.value.slice(i.selectionStart); i.value = i.value.slice(0, t.start) + '@' + n.key + ' ' + after.replace(/^\s+/, ''); const pos = t.start + n.key.length + 2; i.setSelectionRange(pos, pos); closePop(); i.focus(); }
  function openPop() {
    const t = tokenAtCaret(); if (!t) return closePop(); popItems = names().filter(n => n.key.toLowerCase().startsWith(t.q.toLowerCase())); if (!popItems.length) return closePop(); popIdx = Math.min(popIdx, popItems.length - 1);
    if (!pop) { pop = h('div', { class: 'mention-pop', role: 'listbox', 'aria-label': 'Tag someone' }); $('.panel.comms .entry').append(pop); }
    pop.textContent = ''; popItems.forEach((n, k) => pop.append(h('button', { type: 'button', role: 'option', class: 'mp-row' + (k === popIdx ? ' on' : ''), 'aria-selected': String(k === popIdx), onmousedown: e => { e.preventDefault(); pick(n); } }, h('b', {}, '@' + n.key), h('span', {}, n.role))));
  }
  function wireInput() {
    const i = input(); if (!i || i.dataset.chatwired) return; i.dataset.chatwired = '1';
    i.addEventListener('input', () => { popIdx = 0; openPop(); }); i.addEventListener('click', openPop); i.addEventListener('blur', () => setTimeout(closePop, 120));
    i.addEventListener('keydown', e => {
      if (!pop) return; if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); popIdx = (popIdx + (e.key === 'ArrowDown' ? 1 : -1) + popItems.length) % popItems.length; openPop(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); pick(popItems[popIdx]); } else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closePop(); }
    }, true);
  }

  /* ---------- messages: what app.js hands over ---------- */
  const record = (role, text, ms, first) => { if (S.ready && text && text.trim()) bridge.topics.append(role, text, ms == null ? undefined : { ms, first: !!first }).then(refreshTopicsSoon); };
  function paint(el, role, text) {
    const p = el.querySelector('p'); if (!p) return;
    if (role === 'ai') p.replaceWith(body(text)); else if (role === 'user') { p.textContent = ''; p.append(...mentionNodes(text)); }
  }
  function decorate(el, role, text, extra = {}) {
    const now = new Date();
    if (extra.partial) {                                            // speech that is still being heard: the first words of the answer show how long it took to start
      if (role === 'ai') { const base = lastLoud && Date.now() - lastLoud < 20000 ? lastLoud : (lastHeard || lastUserAt), ms = base && Date.now() - base < 120000 ? Date.now() - base : null; lastHeard = lastUserAt = lastLoud = 0; el.dataset.lat = ms == null ? '' : String(ms); stamp(el, now, ms == null ? '' : `first word in ${fmtMs(ms)}`); } else stamp(el, now);
      return;
    }
    if (role === 'user') { lastUserAt = Date.now(); lastHeard = lastLoud = 0; stamp(el, now); paint(el, role, text); record(role, text); return; }
    if (role === 'ai') { const ms = lastUserAt && Date.now() - lastUserAt < 600000 ? Date.now() - lastUserAt : null; lastUserAt = 0; stamp(el, now, ms == null ? '' : `answered in ${fmtMs(ms)}`); paint(el, role, text); record(role, text, ms, false); return; }
    stamp(el, now);                                                 // system lines (a crew member finished, a topic changed...)
  }
  function finalize(el, role) { const p = el && el.querySelector('p'); if (!p) return; const text = p.textContent; paint(el, role, text); const lat = el.dataset.lat; record(role, text, role === 'ai' && lat ? +lat : undefined, true); }

  /* ---------- charts made by Orbit ---------- */
  function showChart(c) {
    const doc = new DOMParser().parseFromString(c.svg, 'image/svg+xml'), svg = doc.documentElement; if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) return;
    const ok = new Set(['svg', 'rect', 'text', 'line', 'path', 'circle', 'polyline']); for (const n of [...svg.querySelectorAll('*')]) if (!ok.has(n.nodeName)) n.remove(); for (const n of [svg, ...svg.querySelectorAll('*')]) for (const a of [...n.attributes]) if (/^on/i.test(a.name)) n.removeAttribute(a.name);
    const node = document.importNode(svg, true), log = $('#log'), near = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
    const copy = h('button', { class: 'mini', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(c.svg); copy.textContent = 'Copied'; } catch { copy.textContent = 'Could not copy'; } setTimeout(() => (copy.textContent = 'Copy SVG'), 1600); } }, 'Copy SVG');
    const png = h('button', { class: 'mini', type: 'button', onclick: () => savePng(c) }, 'Save PNG');
    log.append(h('div', { class: 'msg ai chart' }, h('small', {}, S.cfg.aiName || 'Laila'), h('div', { class: 'chart-box' }, node), h('div', { class: 'chart-actions' }, h('button', { class: 'mini', type: 'button', onclick: () => window.__ws && __ws.open(c.path) }, 'Open in Workspace'), copy, png, h('span', { class: 'chart-path' }, c.path)))); if (near) log.scrollTop = log.scrollHeight;
  }
  function savePng(c) { const img = new Image(); img.onload = () => { const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 920; cv.getContext('2d').drawImage(img, 0, 0, 1600, 920); cv.toBlob(b => { const a = h('a', { href: URL.createObjectURL(b), download: c.path.split('/').pop().replace(/\.svg$/, '.png') }); document.body.append(a); a.click(); a.remove(); }); }; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(c.svg); }

  /* ---------- Quick Run: a card in the Status column, like a widget (not squeezed above the input) ---------- */
  const ICONS = {
    crew: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 19c0-3 3-5 6-5s6 2 6 5v1H2v-1Zm12 1v-1c0-1.2-.4-2.3-1.1-3.200.900-.5 1.900-.8 3.100-.8 3 0 6 2 6 5v1h-8Z',
    star: 'M12 2l2.900 6.300 6.900.8-5.100 4.700 1.400 6.800L12 17.300l-6.100 3.300 1.400-6.800L2.200 9.100l6.900-.8L12 2Z',
    screen: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
    plug: 'M9 2v5H7v3a5 5 0 0 0 4 4.900V22h2v-7.100A5 5 0 0 0 17 10V7h-2V2h-2v5h-2V2H9Z',
    chart: 'M4 20V10h4v10H4Zm6 0V4h4v16h-4Zm6 0v-7h4v7h-4Z',
    bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z'
  };
  const icon = k => { const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('aria-hidden', 'true'); path.setAttribute('d', ICONS[k] || ICONS.bolt); path.setAttribute('fill', 'currentColor'); svg.append(path); return svg; };
  const DEFAULT_QR = [
    { label: 'Crew status', sub: 'Crew \u00B7 who does what', icon: 'crew', prompt: 'Give me a short status: who is on the crew, what each one is doing, and anything waiting for me.' },
    { label: 'Daily briefing', sub: 'Skill \u00B7 daily briefing', icon: 'star', prompt: 'Give me my daily briefing (use your daily-briefing skill).' },
    { label: 'My screen', sub: 'Screen \u00B7 look now', icon: 'screen', prompt: 'Look at my screen and tell me in one or two sentences what you see.' },
    { label: 'My tools', sub: 'Connectors \u00B7 her tools', icon: 'plug', prompt: 'Which connectors and tools do you have right now? List them briefly.' },
    { label: 'New chart', sub: '@chart \u00B7 real numbers', icon: 'chart', prompt: '@chart ', type: true }
  ];
  const clean = v => v.slice(0, 10).map(x => ({ label: x.label, sub: typeof x.sub === 'string' ? x.sub : '', icon: ICONS[x.icon] ? x.icon : 'bolt', prompt: x.prompt, type: x.type || undefined }));
  const loadQR = () => { try { const v = JSON.parse(localStorage.getItem('orbit.quickrun') || 'null'); if (Array.isArray(v) && v.length && v.every(x => x && typeof x.label === 'string' && typeof x.prompt === 'string')) return clean(v); } catch { /* use the defaults */ } return DEFAULT_QR.map(x => ({ ...x })); };
  let qr = loadQR(), qrCard = null, qrEdit = false;
  function runQuick(q) { const i = input(); i.value = q.prompt; i.focus(); if (q.type || /\s$/.test(q.prompt)) { i.setSelectionRange(i.value.length, i.value.length); i.dispatchEvent(new Event('input')); return; } $('#send').click(); }
  function paintQR() {
    if (!qrCard) return; qrCard.textContent = '';
    const head = h('div', { class: 'qr-head' }, h('h3', {}, 'Quick Run'), h('button', { class: 'qr-edit', type: 'button', title: qrEdit ? 'Close the editor' : 'Change the Quick Run buttons', 'aria-label': 'Edit Quick Run', onclick: () => { qrEdit = !qrEdit; paintQR(); } }, qrEdit ? 'Cancel' : '\u270E'));
    if (!qrEdit) { qrCard.append(head, h('div', { class: 'qr-list' }, qr.map(q => h('button', { class: 'qr-tile', type: 'button', 'data-i': q.icon, title: q.prompt || q.label, onclick: () => runQuick(q) }, h('span', { class: 'qr-ico' }, icon(q.icon)), h('span', { class: 'qr-txt' }, h('b', {}, q.label), q.sub ? h('small', {}, q.sub) : null))))); return; }
    const rows = qr.map(q => ({ q, l: h('input', { class: 'qr-in', type: 'text', maxlength: 24, value: q.label, placeholder: 'Name', 'aria-label': 'Button name' }), s: h('input', { class: 'qr-in', type: 'text', maxlength: 40, value: q.sub, placeholder: 'One small line (optional)', 'aria-label': 'Small line' }), p: h('textarea', { class: 'qr-in qr-p', rows: 2, maxlength: 400, placeholder: 'What should she do?', 'aria-label': 'What it says to Laila' }) }));
    rows.forEach(r => { r.p.value = r.q.prompt; });
    qrCard.append(head, h('div', { class: 'qr-editor' }, ...rows.map(r => h('div', { class: 'qr-row' }, r.l, r.s, r.p, h('button', { class: 'mini', type: 'button', onclick: () => { qr = qr.filter(x => x !== r.q); paintQR(); } }, 'Remove'))),
      h('div', { class: 'qr-foot' }, h('button', { class: 'mini', type: 'button', onclick: () => { if (qr.length < 10) { qr.push({ label: 'New', sub: '', icon: 'bolt', prompt: '' }); paintQR(); } } }, '+ Add'), h('button', { class: 'mini', type: 'button', onclick: () => { qr = DEFAULT_QR.map(x => ({ ...x })); localStorage.removeItem('orbit.quickrun'); qrEdit = false; paintQR(); } }, 'Reset'),
        h('button', { class: 'mini go', type: 'button', onclick: () => { qr = clean(rows.map(r => ({ label: r.l.value.trim() || 'Button', sub: r.s.value.trim(), icon: r.q.icon, prompt: r.p.value, type: /^@\w+\s*$/.test(r.p.value) || undefined })).filter(x => x.prompt.trim() || x.label)); try { localStorage.setItem('orbit.quickrun', JSON.stringify(qr)); } catch { /* not saved */ } qrEdit = false; paintQR(); } }, 'Save'))));
  }
  function mountQuickRun() {
    const panel = $('.panel.sys'); if (!panel || panel.querySelector('.quickrun')) return; qrCard = h('div', { class: 'quickrun', 'aria-label': 'Quick Run' }); panel.querySelector('.ph').after(qrCard); paintQR();
    const tiers = panel.querySelector('ul.tiers'); if (tiers && !tiers.closest('details')) { const d = h('details', { class: 'tiers-box' }, h('summary', {}, 'How permissions work')); tiers.replaceWith(d); d.append(tiers); }   // keeps the column short
  }

  /* ---------- Topics ---------- */
  let topicBtn = null, topicPop = null;
  const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min' : s < 129600 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' d'; };
  const refreshTopicsSoon = (() => { let t = null; return () => { clearTimeout(t); t = setTimeout(loadTopics, 600); }; })();
  async function loadTopics() { const r = await bridge.topics.state(); if (!r.ok) return; S.topics = r.topics; S.cur = r.current; paintTopicBtn(); if (topicPop) paintTopicPop(); }
  const curTitle = () => (S.topics.find(t => t.id === S.cur) || { title: 'General' }).title;
  function paintTopicBtn() { if (topicBtn) { topicBtn.querySelector('span').textContent = curTitle(); topicBtn.title = 'Topics: separate conversations, each with its own history'; } }
  function renderHistory(msgs) {
    const log = $('#log'); log.textContent = '';
    for (const m of msgs) { const el = h('div', { class: `msg ${m.role}` }, h('small', {}, m.role === 'user' ? (S.cfg.userName || 'You') : (S.cfg.aiName || 'Laila')), h('p', {}, m.text)); paint(el, m.role, m.text); if (m.t) stamp(el, new Date(m.t), m.ms != null ? `${m.first ? 'first word in ' : 'answered in '}${fmtMs(m.ms)}` : ''); log.append(el); }
    log.scrollTop = log.scrollHeight;
  }
  async function switchTo(id, { create } = {}) {
    if ($('#end-voice') && !$('#end-voice').hidden) $('#end-voice').click();   // a voice session belongs to one conversation
    const r = create ? await bridge.topics.create(create) : await bridge.topics.switchTo(id); if (!r.ok) return alert(r.error);
    S.cur = r.topic.id; renderHistory(r.topic.messages.slice(-60)); $('#log').append(h('div', { class: 'msg sys' }, h('p', {}, create ? 'New topic. Start talking or typing.' : `Topic: ${r.topic.title}. Voice stops when you switch; press the mic to continue here.`)));
    await loadTopics(); closeTopicPop();
  }
  function closeTopicPop() { if (topicPop) { topicPop.remove(); topicPop = null; } }
  function paintTopicPop() {
    if (!topicPop) return; topicPop.textContent = '';
    const nm = h('input', { class: 'tp-new', type: 'text', maxlength: 60, placeholder: 'New topic name (optional)', 'aria-label': 'New topic name' }); const mk = () => switchTo(null, { create: nm.value.trim() || 'New topic' }); nm.addEventListener('keydown', e => { if (e.key === 'Enter') mk(); if (e.key === 'Escape') closeTopicPop(); });
    topicPop.append(h('div', { class: 'tp-head' }, nm, h('button', { class: 'mini go', type: 'button', onclick: mk }, '+ New')));
    const list = h('div', { class: 'tp-list' }); for (const t of S.topics) {
      list.append(h('div', { class: 'tp-row' + (t.id === S.cur ? ' on' : '') }, h('button', { class: 'tp-main', type: 'button', onclick: () => t.id !== S.cur && switchTo(t.id) }, h('b', {}, t.title), h('small', {}, `${t.count} messages \u00B7 ${ago(t.updated)}`)),
        h('button', { class: 'mini', type: 'button', title: 'Rename', 'aria-label': 'Rename ' + t.title, onclick: async () => { const n = prompt('Rename the topic', t.title); if (n && n.trim()) { const r = await bridge.topics.rename(t.id, n); if (!r.ok) alert(r.error); loadTopics(); } } }, 'Rename'),
        h('button', { class: 'mini danger', type: 'button', title: 'Delete', 'aria-label': 'Delete ' + t.title, onclick: async () => { if (!confirm(`Delete the topic "${t.title}" and its ${t.count} messages?`)) return; const r = await bridge.topics.remove(t.id); if (!r.ok) return alert(r.error); if (t.id === S.cur) { S.cur = r.current; const st = await bridge.topics.state(); renderHistory((st.messages || []).slice(-60)); } loadTopics(); } }, 'Delete')));
    }
    topicPop.append(list); nm.focus();
  }
  function toggleTopicPop() { if (topicPop) return closeTopicPop(); topicPop = h('div', { class: 'topic-pop', role: 'dialog', 'aria-label': 'Topics' }); $('.panel.comms').append(topicPop); paintTopicPop(); }
  document.addEventListener('mousedown', e => { if (topicPop && !topicPop.contains(e.target) && !(topicBtn && topicBtn.contains(e.target))) closeTopicPop(); });

  /* ---------- the start-up checklist (every line is a real fact or a real event) ---------- */
  let card = null, cardT = null;
  const steps = () => [['mem', 'Memory'], ['con', 'Connectors'], ['mic', 'Microphone'], ['link', 'Voice link']];
  function showCard() {
    clearTimeout(cardT); if (card) card.remove(); const rows = {}, list = h('div', { class: 'ic-list' });
    for (const [k, label] of steps()) { const v = h('span', { class: 'ic-v' }, '\u2026'), row = h('div', { class: 'ic-row', 'data-k': k, 'data-s': 'run' }, h('i'), h('b', {}, label), v); rows[k] = { row, v }; list.append(row); }
    card = h('div', { class: 'init-card', role: 'status', 'aria-live': 'polite' }, h('div', { class: 'ic-title' }, `${S.cfg.aiName || 'Laila'} \u00B7 starting up`), list); (document.querySelector('#window') || document.body).append(card);
    const done = (k, text, bad) => { const r = rows[k]; if (!r) return; r.row.dataset.s = bad ? 'bad' : 'ok'; r.v.textContent = text; };
    bridge.memory.get().then(m => done('mem', m.ok ? `${m.notes.length} notes, ${m.skills.length} skills` : 'not available', !m.ok));
    bridge.connectors.list().then(c => { const on = c.ok && c.connectors ? c.connectors.filter(x => x.enabled).length : 0; done('con', on ? `${on} connected` : 'none connected'); }).catch(() => done('con', 'not available', true));
    (navigator.permissions ? navigator.permissions.query({ name: 'microphone' }).then(p => done('mic', p.state === 'granted' ? 'allowed' : p.state === 'denied' ? 'blocked in Windows or Chrome' : 'will ask', p.state === 'denied')).catch(() => done('mic', 'unknown')) : Promise.resolve(done('mic', 'unknown')));
    card._done = done;
  }
  function endCard(ok) { if (!card) return; card._done('link', ok ? 'connected' : 'could not connect', !ok); const c = card; cardT = setTimeout(() => { c.classList.add('out'); setTimeout(() => c.remove(), 500); if (card === c) card = null; }, ok ? 1300 : 3500); }
  function watchPill() {
    const pill = $('#pill-net'); if (!pill) return; let last = pill.className;
    new MutationObserver(() => { const cls = pill.className, txt = pill.textContent; if (cls === last && !card) return; const prev = last; last = cls; if (/warn/.test(cls) && !/warn/.test(prev)) showCard(); else if (/ok/.test(cls) && card) endCard(true); else if (!/warn|ok/.test(cls) && /warn/.test(prev)) endCard(false); }).observe(pill, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- the "/" list: crew names (and report / continue) appear as soon as you type a slash ---------- */
  /*slash-suggest-start*/
  function slashSuggest(value, crew, aiName) {
    const v = String(value || ''); if (v[0] !== '/') return [];
    const first = a => String(a.name || '').split(/\s+/)[0].toLowerCase(), ai = String(aiName || 'Laila').toLowerCase();
    const people = (crew || []).filter(a => a && a.name);
    const m = /^\/(\S*)$/.exec(v), m2 = /^\/(\S+)\s+(\S*)$/.exec(v);
    if (m) {
      const q = m[1].toLowerCase();
      const all = [{ text: '/' + ai + ' ', label: '/' + ai, note: 'talk to ' + aiName + ' alone' }]
        .concat(people.map(a => ({ text: '/' + first(a) + ' ', label: '/' + first(a), note: (a.role || 'Crew') + ' · give a job' })))
        .concat([{ text: '/stop ', label: '/stop', note: 'stop a crew member' }]);
      return all.filter((x, i, l) => x.label.slice(1).startsWith(q) && l.findIndex(y => y.label === x.label) === i);
    }
    if (m2) {
      const w = m2[1].toLowerCase(), q = m2[2].toLowerCase();
      if (w === 'stop' || w === 'cancel') return people.filter(a => first(a).startsWith(q) && first(a) !== q).map(a => ({ text: '/stop ' + first(a), label: first(a), note: 'stop ' + a.name }));
      const a = people.find(x => first(x) === w || String(x.id || '').toLowerCase() === w || String(x.name).toLowerCase() === w);
      if (!a) return [];
      return [{ text: '/' + w + ' health', label: 'health', note: 'is it connected and answering?' }, { text: '/' + w + ' report', label: 'report', note: 'stop now and give the report' }, { text: '/' + w + ' continue ', label: 'continue', note: 'carry on from the short note' }].filter(x => x.label.startsWith(q) && x.label !== q);
    }
    return [];
  }
  /*slash-suggest-end*/
  function wireSlash() {
    const i = input(); if (!i || i.dataset.slashwired) return; i.dataset.slashwired = '1';
    let box = null, items = [], idx = 0;
    const close = () => { if (box) { box.remove(); box = null; } items = []; };
    const show = () => {
      items = i.selectionStart === i.value.length ? slashSuggest(i.value, S.crew, S.cfg.aiName) : []; if (!items.length) return close();
      idx = Math.min(idx, items.length - 1);
      if (!box) { box = h('div', { class: 'mention-pop', role: 'listbox', 'aria-label': 'Commands' }); $('.panel.comms .entry').append(box); }
      box.textContent = ''; items.forEach((x, k) => box.append(h('button', { type: 'button', role: 'option', class: 'mp-row' + (k === idx ? ' on' : ''), 'aria-selected': String(k === idx), onmousedown: e => { e.preventDefault(); pick(x); } }, h('b', {}, x.label), h('span', {}, x.note))));
    };
    const pick = x => { i.value = x.text; i.setSelectionRange(i.value.length, i.value.length); close(); i.focus(); i.dispatchEvent(new Event('input')); };
    i.addEventListener('input', () => { idx = 0; show(); }); i.addEventListener('click', show); i.addEventListener('blur', () => setTimeout(close, 120));
    i.addEventListener('keydown', e => {
      if (!box) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; show(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); pick(items[idx]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    }, true);
  }

  /* ---------- start ---------- */
  async function init() {
    if (S.ready) return; S.cfg = await bridge.config.get(); try { S.crew = await bridge.agents.list(); } catch { S.crew = []; } syncNames(); loadGlossary();
    const st = await bridge.topics.state(); if (st.ok) { S.topics = st.topics; S.cur = st.current; const msgs = (st.messages || []).slice(-40); if (msgs.length && $('#log')) { const first = $('#log'); const keep = [...first.children]; renderHistory(msgs); for (const k of keep) first.append(k); } }
    const comms = $('.panel.comms'); if (!comms) return;
    const ph = comms.querySelector('.ph'); topicBtn = h('button', { class: 'topic-btn', type: 'button', 'aria-haspopup': 'dialog', onclick: toggleTopicPop }, h('span', {}, curTitle()), h('i', {}, '\u25BE')); ph.insertBefore(topicBtn, ph.querySelector('#comms-note')); paintTopicBtn();
    mountQuickRun(); wireInput(); wireSlash(); watchPill();
    bridge.onBus(({ type, payload }) => { if (type === 'glossary:changed') loadGlossary(); if (type === 'ui:show' && payload && window.__ws) __ws.show(payload.screen); if (type === 'chart:made') showChart(payload); if (type === 'profile:changed') bridge.config.get().then(c => { S.cfg = c; syncNames(); }); });
    setInterval(() => bridge.agents.list().then(a => { S.crew = a; syncNames(); }).catch(() => {}), 20000);
    S.ready = true;
  }
  const boot = setInterval(() => { if (document.body.classList.contains('phase-bridge') && $('#log') && window.bridge && bridge.topics) { clearInterval(boot); init(); } }, 300);

  window.__chat = { decorate, finalize, heard, level, script, fmtMs, clock, outgoing, body, mentionsIn, showChart, state: () => S, qr: () => qr };
})();
