/* Code sandbox: choose which crew members run their shell and files inside Docker, and which folders they can see. */
(() => {
  'use strict';
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return el; };
  const gb = mb => (mb / 1024) % 1 ? (mb / 1024).toFixed(1) : String(mb / 1024);
  let back = null, crew = [], sel = '';

  async function open() {
    if (back) return; crew = (await bridge.agents.list()).filter(a => a && a.id && a.id !== 'jarvis'); sel = crew[0] ? crew[0].id : '';
    const body = h('div', { class: 'sb-body' }), pick = h('select', { class: 'sb-pick', 'aria-label': 'Crew member', onchange: () => { sel = pick.value; render(body); } }, crew.map(a => h('option', { value: a.id }, `${a.name} \u2014 ${a.role}`)));
    const box = h('div', { class: 'sb-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Code sandbox' }, h('div', { class: 'sb-head' }, h('h2', {}, 'Code sandbox'), h('button', { class: 'mini', type: 'button', onclick: close }, 'Close')),
      h('p', { class: 'sb-lead' }, 'A crew member who runs code can be locked into a Docker container: it sees only the folders you choose, none of your keys, settings or the rest of your computer.'), crew.length ? h('label', { class: 'sb-row' }, h('span', {}, 'Crew member'), pick) : h('p', {}, 'There are no crew members yet.'), body);
    back = h('div', { class: 'sb-back', onmousedown: e => { if (e.target === back) close(); } }, box); document.body.append(back); back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }); if (crew.length) render(body); pick.focus();
  }
  function close() { if (back) { back.remove(); back = null; } }

  async function render(body) {
    body.textContent = ''; body.append(h('p', { class: 'sb-muted' }, 'Checking Docker\u2026')); const id = sel; const r = await bridge.sandbox.get(id); if (id !== sel || !back) return; body.textContent = '';
    if (!r.ok) { body.append(h('p', { class: 'sb-bad' }, r.error)); return; }
    const S = { ...r.sandbox, folders: [...r.sandbox.folders] }, d = r.docker, maxMem = d.ok ? Math.max(1024, d.memMB - 1536) : 1e9;
    const dock = h('div', { class: 'sb-pill ' + (d.ok ? 'ok' : 'bad') }, d.ok ? `Docker is running \u00B7 ${gb(d.memMB)} GB memory` : d.error), state = h('p', { class: 'sb-state' }), st = h('div', { class: 'sb-status' }), out = h('div', { class: 'sb-steps' });
    const on = h('input', { type: 'checkbox', id: 'sb-on' }); on.checked = !!S.enabled; on.addEventListener('change', () => { S.enabled = on.checked; paint(); });
    const list = h('div', { class: 'sb-folders' }), net = h('select', { class: 'sb-sel', 'aria-label': 'Network' }, h('option', { value: 'on' }, 'Internet allowed (npm, pip, git)'), h('option', { value: 'off' }, 'No internet at all')); net.value = S.network ? 'on' : 'off'; net.addEventListener('change', () => { S.network = net.value === 'on'; });
    const mem = h('select', { class: 'sb-sel', 'aria-label': 'Memory' }, r.memChoices.map(m => h('option', { value: m, disabled: m > maxMem }, `${gb(m)} GB${m > maxMem ? ' (more than Docker has)' : ''}`))); mem.value = String(r.memChoices.includes(S.memoryMB) && S.memoryMB <= maxMem ? S.memoryMB : Math.min(...r.memChoices)); S.memoryMB = +mem.value; mem.addEventListener('change', () => { S.memoryMB = +mem.value; });
    function paint() {
      state.textContent = S.enabled ? 'Now: its shell and file tools run inside a Docker container. It sees only the folders below and its own output folder.' : 'Now: its shell and file tools run on your computer, with your rights. Anything you can open, it can open.'; state.className = 'sb-state ' + (S.enabled ? 'ok' : 'warn');
      list.textContent = ''; if (!S.folders.length) list.append(h('div', { class: 'sb-empty' }, 'No project folder yet. Without one it can only work in its own output folder.'));
      for (const f of S.folders) list.append(h('div', { class: 'sb-folder' }, h('span', { title: f }, f), h('button', { class: 'mini', type: 'button', onclick: () => { S.folders = S.folders.filter(x => x !== f); paint(); } }, 'Remove')));
    }
    async function add() { const pk = await bridge.sandbox.pick(); if (pk.ok && pk.path && !S.folders.includes(pk.path)) { S.folders.push(pk.path); paint(); } }
    async function save() { st.className = 'sb-status'; st.textContent = 'Saving\u2026'; const x = await bridge.sandbox.set(id, { enabled: S.enabled, folders: S.folders, network: S.network, memoryMB: S.memoryMB }); if (!x.ok) { st.className = 'sb-status bad'; st.textContent = x.error; return false; } S.folders = x.sandbox.folders; paint(); st.className = 'sb-status ok'; st.textContent = 'Saved. It applies from the next job (a running job finishes as it was).'; return true; }
    async function test() { out.textContent = ''; if (!(await save())) return; st.className = 'sb-status'; st.textContent = 'Testing with real containers\u2026 the first time it downloads the image (about 1 GB), which can take a few minutes.'; const x = await bridge.sandbox.test(id); if (!x.ok) { st.className = 'sb-status bad'; st.textContent = x.error; return; } st.className = 'sb-status ' + (x.ok && x.steps.every(s => s.ok) ? 'ok' : 'bad'); st.textContent = x.steps.every(s => s.ok) ? 'The sandbox works: it starts, it sees your folders, and it sees nothing else.' : 'Something is not right yet:'; for (const s of x.steps) out.append(h('div', { class: 'sb-step ' + (s.ok ? 'ok' : 'bad') }, h('i'), h('b', {}, s.name), h('span', {}, s.detail))); }
    body.append(dock, h('label', { class: 'sb-check', for: 'sb-on' }, on, h('span', {}, 'Run this member\u2019s shell and files in a Docker sandbox')), state, h('div', { class: 'sb-h' }, 'Folders it may work in'), list, h('button', { class: 'mini', type: 'button', onclick: add }, 'Add a folder\u2026'),
      h('div', { class: 'sb-two' }, h('label', { class: 'sb-row' }, h('span', {}, 'Network'), net), h('label', { class: 'sb-row' }, h('span', {}, 'Memory'), mem)), h('p', { class: 'sb-muted' }, `Output folder (mounted as /output; Laila can read what it leaves there): ${r.output}`),
      h('div', { class: 'sb-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save'), h('button', { class: 'btn', type: 'button', onclick: test }, 'Test the sandbox')), st, out); paint();
  }

  const tryButton = () => { const bar = document.querySelector('.sys-actions'); if (bar && !bar.querySelector('#open-sandbox')) bar.prepend(h('button', { class: 'mini', id: 'open-sandbox', type: 'button', onclick: open }, 'Sandbox'), ' '); };
  tryButton(); setTimeout(tryButton, 1600); window.__sandbox = { open, close };
})();
