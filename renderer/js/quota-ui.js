/* Quota: per-model rows in the Usage card, the limits table, and the window that shows which models the key can use and switches the everyday one. */
(() => {
  'use strict';
  if (!window.bridge || !bridge.quota) return;
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return el; };
  const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(Math.round(n)));
  const say = t => { try { window.__ui.addMsg('sys', t); } catch { /* the chat is not ready */ } };
  const limText = l => (l ? [l.rpd ? `${l.rpd} requests a day` : 'no daily cap', l.rpm ? `${l.rpm} a minute` : null].filter(Boolean).join(', ') : 'limit not set');
  let box = null, list = null;

  function mount() {
    const usage = document.querySelector('.panel.sys .usage'); if (!usage) return false; if (usage.querySelector('.q-models')) return true;
    list = h('div', { class: 'q-models', 'aria-label': 'Quota by model' }); const tools = h('div', { class: 'q-tools' }, h('button', { class: 'mini', type: 'button', onclick: openModels }, 'Models\u2026'), h('button', { class: 'mini', type: 'button', onclick: openLimits }, 'Limits\u2026'), h('button', { class: 'mini', type: 'button', title: 'Google\u2019s own numbers for your project', onclick: () => bridge.openExternal('https://aistudio.google.com/rate-limit') }, 'AI Studio'));
    usage.append(list, tools); return true;
  }
  function paint(s) {
    if (!s || !s.quota || !mount()) return; list.textContent = '';
    for (const r of s.quota) {
      const day = r.rpd ? `${r.rpd.used} / ${r.rpd.limit} today` : `${r.req} request${r.req === 1 ? '' : 's'} today`, pctBar = r.rpd ? Math.min(100, r.rpd.pct) : (r.tpm ? Math.min(100, r.tpm.pct) : 0);
      const min = [r.rpm ? `${r.rpm.used}/${r.rpm.limit} req` : null, r.tpm ? `${fmt(r.tpm.used)}/${fmt(r.tpm.limit)} tokens` : null].filter(Boolean).join(' \u00B7 ');
      list.append(h('div', { class: 'q-row', 'data-level': r.level, title: `${r.model}\n${r.known ? '' : 'No limit is set for this model: add one under Limits.\n'}The crew\u2019s own requests are not counted here (only its tokens): AI Studio has the exact number.` },
        h('div', { class: 'q-top' }, h('span', { class: 'q-name' }, r.name), h('span', { class: 'q-val' }, day)), h('div', { class: 'q-bar' }, h('i', { style: `width:${Math.max(r.req || r.rpd ? 2 : 0, pctBar)}%` })), min ? h('small', { class: 'q-sub' }, `this minute ${min}`) : null));
    }
  }
  bridge.onBus(({ type, payload }) => { if (type === 'usage') paint(payload); else if (type === 'quota:warn') say(payload.text + (payload.kind === 'rpd' ? ` It resets at ${resetClock()} on your clock.` : '')); });
  let resetsAt = 0; bridge.usage.get().then(s => { resetsAt = Date.now() + (s.resetsInMs || 0); paint(s); }).catch(() => {});
  const resetClock = () => (resetsAt ? new Date(resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'midnight Pacific time');
  const t = setInterval(() => { if (mount()) { clearInterval(t); bridge.usage.get().then(paint).catch(() => {}); } }, 700);

  /* ---------- windows ---------- */
  function shell(title, lead, bodyEl) { const b = h('div', { class: 'sb-back', onmousedown: e => { if (e.target === b) close(); } }, h('div', { class: 'sb-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'sb-head' }, h('h2', {}, title), h('button', { class: 'mini', type: 'button', onclick: close }, 'Close')), lead ? h('p', { class: 'sb-lead' }, lead) : null, bodyEl)); b.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }); return b; }
  function close() { if (box) { box.remove(); box = null; } }

  async function openModels() {
    close(); const body = h('div', { class: 'sb-body' }, h('p', { class: 'sb-muted' }, 'Asking Google which models your key can use\u2026')); box = shell('Models and quota', 'Your free Gemini allowance is counted per model. Everyday work (chat answers, web search, looking at the screen, and the crew) uses one model; the voice uses another.', body); document.body.append(box);
    const r = await bridge.quota.models(); if (!box) return; body.textContent = '';
    if (!r.ok) { body.append(h('p', { class: 'sb-bad' }, r.error)); return; }
    const cur = r.current.text, curLimit = (r.limits.find(l => cur.toLowerCase().includes(l.match)) || null); let pick = cur; const st = h('div', { class: 'sb-status' });
    body.append(h('p', { class: 'sb-state ' + (curLimit && curLimit.rpd && curLimit.rpd < 100 ? 'warn' : 'ok') }, `Everyday model now: ${cur} \u2014 ${limText(curLimit)}.`), h('p', { class: 'sb-muted' }, `Voice model: ${r.current.live} (its daily requests are not capped on your project).`));
    const rows = h('div', { class: 'q-opts', role: 'radiogroup', 'aria-label': 'Everyday model' });
    for (const m of r.everyday) { const id = 'q-' + m.id; const rad = h('input', { type: 'radio', name: 'q-pick', id, value: m.id }); rad.checked = m.id === cur; rad.addEventListener('change', () => { pick = m.id; }); rows.append(h('label', { class: 'q-opt', for: id }, rad, h('span', { class: 'q-oid' }, m.id), h('span', { class: 'q-obadges' }, m.lite ? h('b', { class: 'b-lite' }, 'Lite') : null, m.preview ? h('b', { class: 'b-prev' }, 'preview') : null, m.id === r.recommended ? h('b', { class: 'b-rec' }, 'recommended') : null), h('small', {}, limText(m.limit)))); }
    if (!r.everyday.length) rows.append(h('p', { class: 'sb-muted' }, 'No everyday Flash models were listed for this key.'));
    body.append(h('div', { class: 'sb-h' }, 'Choose the everyday model'), rows, h('p', { class: 'sb-muted' }, 'Lite is faster and has far more free requests, but it is weaker at hard reasoning and at code. The crew uses this model too. You can switch back any time. Limits shown come from the Limits table (your AI Studio numbers); a change to billing changes them.'),
      h('div', { class: 'sb-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: async () => { if (pick === cur) { st.className = 'sb-status'; st.textContent = 'That is already the everyday model.'; return; } st.textContent = 'Saving\u2026'; const x = await bridge.quota.setText(pick); if (!x.ok) { st.className = 'sb-status bad'; st.textContent = x.error; return; } if (window.__refreshCfg) __refreshCfg(); st.className = 'sb-status ok'; st.textContent = `Saved. Chat answers, web search and new crew jobs now use ${pick}. A crew member already working finishes on the old one.`; } }, 'Use this for everyday work'), r.recommended && r.recommended !== cur ? h('button', { class: 'btn', type: 'button', onclick: () => { const rd = box.querySelector(`input[value="${r.recommended}"]`); if (rd) { rd.checked = true; pick = r.recommended; } } }, 'Select the recommended one') : null), st);
  }

  async function openLimits() {
    close(); const r = await bridge.quota.limits(); if (!r.ok) return; const rows = r.limits.map(l => ({ ...l })), tbody = h('div', { class: 'q-lim' }), st = h('div', { class: 'sb-status' });
    const cell = (v, ph, w) => h('input', { class: 'q-in', type: 'text', inputmode: 'numeric', value: v == null ? '' : v, placeholder: ph, style: `width:${w}px` });
    const draw = () => { tbody.textContent = ''; tbody.append(h('div', { class: 'q-lh' }, h('span', {}, 'Model name contains'), h('span', {}, 'Shown as'), h('span', {}, 'Req/min'), h('span', {}, 'Tokens/min'), h('span', {}, 'Req/day'), h('span', {}))); rows.forEach((row, i) => { const m = h('input', { class: 'q-in', type: 'text', value: row.match, placeholder: 'flash-lite', maxlength: 40 }), n = h('input', { class: 'q-in', type: 'text', value: row.name, maxlength: 30 }), a = cell(row.rpm, '\u221E', 70), b = cell(row.tpm, '\u221E', 90), c = cell(row.rpd, '\u221E', 80); row.el = { m, n, a, b, c }; tbody.append(h('div', { class: 'q-lr' }, m, n, a, b, c, h('button', { class: 'mini', type: 'button', onclick: () => { grab(); rows.splice(i, 1); draw(); } }, 'Remove'))); }); };
    const grab = () => rows.forEach(r => { if (r.el) { r.match = r.el.m.value; r.name = r.el.n.value; r.rpm = r.el.a.value; r.tpm = r.el.b.value; r.rpd = r.el.c.value; } });
    draw(); const body = h('div', { class: 'sb-body' }, tbody, h('p', { class: 'sb-muted' }, 'Copy the numbers from AI Studio > Rate Limit, for the project your key belongs to. Empty means unlimited. The first row whose name part appears in the model name is used, so put the more specific ones (like flash-lite) above the general ones (flash).'),
      h('div', { class: 'sb-actions' }, h('button', { class: 'mini', type: 'button', onclick: () => { grab(); rows.push({ match: '', name: '', rpm: null, tpm: null, rpd: null }); draw(); } }, '+ Add a row'), h('button', { class: 'mini', type: 'button', onclick: async () => { const x = await bridge.quota.resetLimits(); if (x.ok) { rows.length = 0; rows.push(...x.limits.map(l => ({ ...l }))); draw(); st.className = 'sb-status ok'; st.textContent = 'Back to the numbers from your AI Studio screenshot.'; refresh(); } } }, 'Reset'), h('button', { class: 'btn primary', type: 'button', onclick: async () => { grab(); const x = await bridge.quota.setLimits(rows.map(({ match, name, rpm, tpm, rpd }) => ({ match, name, rpm, tpm, rpd }))); if (!x.ok) { st.className = 'sb-status bad'; st.textContent = x.error; return; } st.className = 'sb-status ok'; st.textContent = 'Saved.'; refresh(); } }, 'Save')), st);
    box = shell('Quota limits', 'What Google allows your project, per model. Orbit compares your use against these.', body); document.body.append(box);
  }
  const refresh = () => bridge.usage.get().then(paint).catch(() => {});
  window.__quota = { openModels, openLimits, paint };
})();
