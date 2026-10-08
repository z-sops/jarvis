/* Workspace screen: every file Laila and the crew saved, with a viewer. Also the screen switcher in the top bar.
   Files written by the crew are untrusted: nothing here uses innerHTML, and a link is only opened after a click, in the browser. */
(function () {
  'use strict';
  if (!window.bridge || !bridge.workspace) return;
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v); } for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid)); return el; };
  const fmtSize = n => (n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : new Date(t).toLocaleDateString(); };

  /* ---------- safe Markdown: builds DOM nodes, never HTML ---------- */
  const link = (url, label) => h('a', { class: 'md-a', href: '#', 'data-url': url, title: url }, label);
  function inline(text) {
    const out = []; let i = 0; const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(!?\[[^\]]*\]\([^)]+\))|(https?:\/\/[^\s)<>]+)/g; let m;
    while ((m = re.exec(text))) {
      if (m.index > i) out.push(text.slice(i, m.index)); const t = m[0];
      if (m[1]) out.push(h('code', {}, t.slice(1, -1)));
      else if (m[2] || m[3]) out.push(h('strong', {}, ...inline(t.slice(2, -2))));
      else if (m[4]) out.push(h('em', {}, ...inline(t.slice(1, -1))));
      else if (m[5]) { const mm = /^(!?)\[([^\]]*)\]\(([^)]+)\)$/.exec(t); out.push(mm[1] ? h('span', { class: 'md-img' }, '[image: ' + (mm[2] || 'no name') + ']') : link(mm[3].trim().split(/\s+/)[0], mm[2] || mm[3])); }
      else out.push(link(t.replace(/[.,;:!?]+$/, ''), t.replace(/[.,;:!?]+$/, '')));
      i = m.index + t.length;
    }
    if (i < text.length) out.push(text.slice(i)); return out;
  }
  const isBlockStart = l => /^(```|#{1,6}\s|>\s?|\s*([-*+]|\d+[.)])\s+|\s*([-*_])(\s*\3){2,}\s*$)/.test(l);
  function markdown(src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n'), out = []; let i = 0;
    const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(h('pre', { class: 'md-code' }, h('code', {}, buf.join('\n')))); continue; }
      const hm = /^(#{1,6})\s+(.*)$/.exec(line); if (hm) { out.push(h('h' + Math.min(hm[1].length, 4), {}, ...inline(hm[2].replace(/\s+#+\s*$/, '')))); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push(h('hr')); i++; continue; }
      if (/^>\s?/.test(line)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(h('blockquote', {}, ...markdown(buf.join('\n')))); continue; }
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const head = cells(line); i += 2; const rows = []; while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(h('div', { class: 'md-tablewrap' }, h('table', { class: 'md-table' }, h('thead', {}, h('tr', {}, ...head.map(c => h('th', {}, ...inline(c))))), h('tbody', {}, ...rows.map(r => h('tr', {}, ...head.map((_, k) => h('td', {}, ...inline(r[k] || ''))))))))); continue; }
      const lm = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
      if (lm) {
        const ordered = /\d/.test(lm[2]), base = lm[1].length, items = [];
        while (i < lines.length) {
          const m2 = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]); if (!m2 || m2[1].length < base) break;
          if (m2[1].length > base) { const sub = []; while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) && lines[i].search(/\S/) > base)) sub.push(lines[i++]); const last = items[items.length - 1]; if (last) last.append(...markdown(sub.join('\n'))); continue; }
          let body = m2[3]; const task = /^\[([ xX])\]\s+(.*)$/.exec(body); const li = h('li', {}, task ? (task[1] === ' ' ? '\u2610 ' : '\u2611 ') : null, ...inline(task ? task[2] : body)); items.push(li); i++;
        }
        out.push(h(ordered ? 'ol' : 'ul', {}, ...items)); continue;
      }
      if (!line.trim()) { i++; continue; }
      const buf = [line]; i++; while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++]);
      out.push(h('p', {}, ...inline(buf.join(' '))));
    }
    return out;
  }
  function parseCsv(text, delim) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length && rows.length <= 500; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true; else if (c === delim) { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); } return rows.filter(r => r.some(c => c.trim() !== ''));
  }

  /* ---------- the screen switcher ---------- */
  const topbar = document.getElementById('topbar'), right = topbar && topbar.querySelector('.tb-right');
  const tabs = {};
  const nav = h('nav', { class: 'tb-nav', 'aria-label': 'Screens' });
  for (const [id, label, key] of [['bridge', 'Orbit', '1'], ['office', 'Office', '2'], ['workspace', 'Workspace', '3'], ['browser', 'Browser', '4'], ['connectors', 'Connectors', '5'], ['memory', 'Memory', '6'], ['library', 'Library', '7']]) { tabs[id] = h('button', { type: 'button', class: 'tb-tab', title: `${label} (Alt+${key})`, onclick: () => show(id) }, label); nav.append(tabs[id]); }
  if (topbar && right) topbar.insertBefore(nav, right);

  /* ---------- the screen ---------- */
  const state = { entries: [], open: new Set(JSON.parse(localStorage.getItem('ws.open') || '[]')), first: !localStorage.getItem('ws.open'), sel: localStorage.getItem('ws.sel') || '', filter: '', file: null, editing: false, dirty: false };
  const treeBox = h('div', { class: 'ws-tree', role: 'tree' }), view = h('div', { class: 'ws-view' });
  const search = h('input', { class: 'ws-search', type: 'search', placeholder: 'Search files', 'aria-label': 'Search files', oninput: e => { state.filter = e.target.value.trim().toLowerCase(); renderTree(); } });
  const title = h('div', { class: 'ws-title' }), meta = h('div', { class: 'ws-meta' }), actions = h('div', { class: 'ws-actions' }), toastEl = h('span', { class: 'ws-toast', role: 'status' });
  const side = h('div', { class: 'ws-box ws-side' },
    h('div', { class: 'ws-head' }, h('h2', {}, 'Workspace'), h('span', { class: 'ws-count', id: 'ws-count' }), h('button', { class: 'mini', type: 'button', title: 'Reload the list', onclick: () => refresh(true) }, 'Refresh'), h('button', { class: 'mini', type: 'button', title: 'Open the workspace folder in Explorer', onclick: () => bridge.workspace.openRoot() }, 'Folder')),
    search, treeBox);
  const main = h('div', { class: 'ws-box ws-main' }, h('div', { class: 'ws-head ws-fhead' }, h('div', { class: 'ws-ftext' }, title, meta), toastEl, actions), view);
  const root = h('section', { id: 'workspace', 'aria-label': 'Workspace' }, h('div', { class: 'ws-wrap' }, side, main));
  document.body.append(root);

  const toast = t => { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('on'), 2600); };
  const dot = n => (n.ext === '.md' || n.ext === '.markdown' ? 'md' : /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n.ext) ? 'img' : /\.(csv|tsv|xlsx?)$/.test(n.ext) ? 'csv' : n.ext === '.json' ? 'json' : /\.(py|js|ts|tsx|jsx|html|css|sh|bat|ps1|sql)$/.test(n.ext) ? 'code' : 'txt');
  function persist() { localStorage.setItem('ws.open', JSON.stringify([...state.open])); localStorage.setItem('ws.sel', state.sel); }

  function allFiles(list, out = []) { for (const n of list) n.dir ? allFiles(n.children || [], out) : out.push(n); return out; }
  function renderTree() {
    treeBox.textContent = ''; const files = allFiles(state.entries); document.getElementById('ws-count').textContent = files.length ? files.length + (files.length === 1 ? ' file' : ' files') : '';
    if (!state.entries.length) { treeBox.append(h('div', { class: 'ws-empty' }, 'Nothing here yet.', h('br'), 'Files that Laila and the crew save show up here by themselves.')); return; }
    if (state.filter) {
      const hits = files.filter(n => n.rel.toLowerCase().includes(state.filter)).sort((a, b) => b.mtime - a.mtime).slice(0, 200);
      if (!hits.length) treeBox.append(h('div', { class: 'ws-empty' }, 'No file matches "' + state.filter + '".'));
      for (const n of hits) treeBox.append(fileRow(n, 0, true)); return;
    }
    const walk = (list, depth) => { for (const n of list) { if (n.dir) { const open = state.open.has(n.rel); treeBox.append(dirRow(n, depth, open)); if (open) walk(n.children || [], depth + 1); } else treeBox.append(fileRow(n, depth)); } };
    walk(state.entries, 0);
  }
  function dirRow(n, depth, open) {
    const count = allFiles(n.children || []).length;
    return h('div', { class: 'ws-row dir' + (n.agent ? ' agent' : ''), role: 'treeitem', 'aria-expanded': String(open), tabindex: 0, style: `padding-left:${8 + depth * 14}px`, onclick: () => { open ? state.open.delete(n.rel) : state.open.add(n.rel); persist(); renderTree(); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } },
      h('span', { class: 'ws-caret' }, open ? '\u25BE' : '\u25B8'), h('span', { class: 'ws-name' }, n.agent ? n.agent.name : n.name), n.agent && n.agent.role ? h('span', { class: 'ws-role' }, n.agent.role) : null, h('span', { class: 'ws-size' }, count ? String(count) : ''));
  }
  function fileRow(n, depth, flat) {
    const fresh = Date.now() - n.mtime < 180000;
    return h('div', { class: 'ws-row file' + (state.sel === n.rel ? ' sel' : ''), role: 'treeitem', tabindex: 0, title: n.rel, style: `padding-left:${8 + depth * 14}px`, onclick: () => openFile(n.rel), onkeydown: e => { if (e.key === 'Enter') openFile(n.rel); } },
      h('i', { class: 'ws-dot k-' + dot(n) }), h('span', { class: 'ws-name' }, flat ? n.rel : n.name), fresh ? h('span', { class: 'ws-new' }, 'new') : null, h('span', { class: 'ws-size' }, fmtSize(n.size)));
  }

  function showEmpty() { title.textContent = 'No file open'; meta.textContent = ''; actions.textContent = ''; view.textContent = ''; view.append(h('div', { class: 'ws-placeholder' }, h('b', {}, 'Pick a file on the left.'), h('span', {}, 'Reports and files that Laila and the crew save appear here as they are written.'))); }
  function paintHead(f) {
    title.textContent = f.name; meta.textContent = [f.rel, fmtSize(f.size), f.mtime ? 'changed ' + ago(f.mtime) : ''].filter(Boolean).join('  \u00B7  '); actions.textContent = '';
    if (state.editing) actions.append(h('button', { class: 'mini primary', type: 'button', onclick: save }, 'Save'), h('button', { class: 'mini', type: 'button', onclick: () => { state.editing = false; state.dirty = false; renderFile(); } }, 'Cancel'));
    else { if (f.kind === 'text' && f.editable) actions.append(h('button', { class: 'mini', type: 'button', onclick: () => { state.editing = true; state.dirty = false; renderFile(); } }, 'Edit')); actions.append(h('button', { class: 'mini', type: 'button', title: 'Show this file in Explorer', onclick: () => bridge.workspace.reveal(f.rel) }, 'Show in folder')); }
  }
  function renderFile() {
    const f = state.file; if (!f) return showEmpty(); paintHead(f); view.textContent = '';
    if (f.kind === 'dir') return view.append(h('div', { class: 'ws-placeholder' }, h('b', {}, 'This is a folder.'), h('span', {}, 'Open it in the list on the left.')));
    if (f.kind === 'image') return view.append(h('div', { class: 'ws-imgwrap' }, h('img', { class: 'ws-img', src: f.dataUrl, alt: f.name })));
    if (f.kind !== 'text') return view.append(h('div', { class: 'ws-placeholder' }, h('b', {}, 'No preview for this file.'), h('span', {}, f.note || ''), h('button', { class: 'mini', type: 'button', onclick: () => bridge.workspace.reveal(f.rel) }, 'Show in folder')));
    if (state.editing) { const ta = h('textarea', { class: 'ws-edit', spellcheck: 'false', 'aria-label': 'Edit ' + f.name, oninput: () => { state.dirty = true; } }); ta.value = f.text; view.append(ta); ta.focus(); return; }
    if (f.truncated) view.append(h('div', { class: 'ws-warn' }, 'This file is bigger than 1 MB. Only the start is shown, and it cannot be edited here.'));
    const ext = f.ext;
    if (ext === '.md' || ext === '.markdown') view.append(h('article', { class: 'md' }, ...markdown(f.text)));
    else if (ext === '.csv' || ext === '.tsv') { const rows = parseCsv(f.text, ext === '.tsv' ? '\t' : ','); view.append(h('div', { class: 'md-tablewrap' }, h('table', { class: 'md-table csv' }, ...(rows.length ? [h('thead', {}, h('tr', {}, ...rows[0].slice(0, 40).map(c => h('th', {}, c)))), h('tbody', {}, ...rows.slice(1, 500).map(r => h('tr', {}, ...r.slice(0, 40).map(c => h('td', {}, c)))))] : [])))); if (rows.length >= 500) view.append(h('div', { class: 'ws-warn' }, 'Only the first 500 rows are shown.')); }
    else if (ext === '.json') { let t = f.text; try { t = JSON.stringify(JSON.parse(f.text), null, 2); } catch { /* not valid JSON: show it as it is */ } view.append(h('pre', { class: 'ws-code' }, t)); }
    else view.append(h('pre', { class: 'ws-code' }, f.text));
    view.scrollTop = 0;
  }
  async function openFile(rel, quiet) {
    if (state.editing && state.dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
    state.editing = false; state.dirty = false; state.sel = rel; persist(); renderTree();
    const r = await bridge.workspace.read(rel);
    if (!r.ok) { state.file = null; showEmpty(); if (!quiet) toast(r.error); return; }
    state.file = r.file; renderFile();
  }
  async function save() {
    const ta = view.querySelector('textarea'); if (!ta || !state.file) return;
    const r = await bridge.workspace.write(state.file.rel, ta.value); if (!r.ok) return toast(r.error);
    state.editing = false; state.dirty = false; toast('Saved'); await openFile(state.file.rel, true);
  }
  async function refresh(manual) {
    const r = await bridge.workspace.tree();
    if (!r.ok) { treeBox.textContent = ''; treeBox.append(h('div', { class: 'ws-empty' }, 'Could not read the workspace: ' + r.error)); return; }
    state.entries = r.entries; if (state.first) { for (const n of r.entries) if (n.dir && n.agent) state.open.add(n.rel); state.first = false; persist(); }
    renderTree(); if (manual) toast('Updated');
    if (state.file && !state.editing && !state.file.dir) { const n = allFiles(state.entries).find(x => x.rel === state.file.rel); if (n && n.mtime !== state.file.mtime) openFile(state.file.rel, true); else if (!n && state.file.kind !== 'dir') { state.file = null; showEmpty(); } }
  }
  let timer = null;
  function onChanged() { clearTimeout(timer); timer = setTimeout(() => { if (document.body.dataset.view === 'workspace') refresh(); }, 250); }

  async function enterWorkspace() { await refresh(); if (!state.file && state.sel) openFile(state.sel, true); }
  // Screens: bridge, office, workspace. The folder watcher runs while the office or the workspace is on screen.
  function show(id, opts = {}) {
    const cur = document.body.dataset.view || 'bridge'; if (id === cur || !tabs[id]) return;
    if (cur === 'workspace') { if (state.editing && state.dirty && !confirm('You have unsaved changes. Leave without saving?')) return; state.editing = false; state.dirty = false; }
    if (cur === 'office' && window.__office) __office.leave();
    if (cur === 'browser' && window.__browser) __browser.leave();
    if (cur === 'connectors' && window.__connectors) __connectors.leave();
    document.body.dataset.view = id; bridge.workspace.watch(id === 'workspace' || id === 'office');
    if (id === 'workspace') enterWorkspace(); else if (id === 'office' && window.__office) __office.enter(opts.from); else if (id === 'browser' && window.__browser) __browser.enter(); else if (id === 'connectors' && window.__connectors) __connectors.enter(); else if (id === 'memory' && window.__memory) __memory.enter(); else if (id === 'library' && window.__library) __library.enter();
    for (const [k, b] of Object.entries(tabs)) b.setAttribute('aria-current', String(document.body.dataset.view === k));
  }
  document.body.dataset.view = 'bridge'; tabs.bridge.setAttribute('aria-current', 'true'); tabs.workspace.setAttribute('aria-current', 'false');
  bridge.onBus(({ type }) => { if (type === 'ws:changed') onChanged(); });
  view.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a.md-a'); if (!a) return; e.preventDefault(); const u = a.getAttribute('data-url'); if (/^https?:\/\//i.test(u) && confirm('Open this link in your browser?\n\n' + u)) bridge.openExternal(u); });
  addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && ['1', '2', '3', '4', '5', '6', '7'].includes(e.key)) { e.preventDefault(); show({ 1: 'bridge', 2: 'office', 3: 'workspace', 4: 'browser', 5: 'connectors', 6: 'memory', 7: 'library' }[e.key]); }
    else if (e.key === 'Escape' && (document.body.dataset.view === 'office' || (document.body.dataset.view === 'workspace' && !state.editing && document.activeElement !== search))) show('bridge');
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.editing) { e.preventDefault(); save(); }
  });
  showEmpty();
  window.__md = markdown; window.__ws = { show, refresh, open: rel => { show('workspace'); return openFile(rel); }, focus: agentId => { if (agentId) { state.open.add(agentId); persist(); } show('workspace'); return refresh(); }, markdown, parseCsv };
})();
