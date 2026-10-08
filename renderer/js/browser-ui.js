/* The Browser screen: Orbit's own private browser, live. You watch it, you can take over (to sign in, for example), and you set the rules. */
(() => {
  'use strict';
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return el; };
  const S = { ctxs: [], view: 'orbit', activity: [], settings: {}, mcpPort: 0, active: false, dirty: false };
  const NICE_CTX = id => (id === 'orbit' ? 'Orbit browser' : id.startsWith('agent-') ? id.slice(6).replace(/^./, c => c.toUpperCase()) + "'s own browser" : id);
  const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const host = u => { try { return new URL(u).host || u; } catch { return u || ''; } };

  /* ---------- the parts ---------- */
  const ctxSel = h('select', { class: 'bw-ctx', 'aria-label': 'Which browser', onchange: e => selectCtx(e.target.value) });
  const back = h('button', { class: 'bw-btn', type: 'button', title: 'Back', onclick: () => bridge.browser.tab(S.view, 'back') }, '\u2039'), fwd = h('button', { class: 'bw-btn', type: 'button', title: 'Forward', onclick: () => bridge.browser.tab(S.view, 'forward') }, '\u203A'), reload = h('button', { class: 'bw-btn', type: 'button', title: 'Reload', onclick: () => bridge.browser.tab(S.view, 'reload') }, '\u21BB');
  const url = h('input', { class: 'bw-url', type: 'text', spellcheck: 'false', placeholder: 'Type an address or search words', 'aria-label': 'Address', onkeydown: async e => { if (e.key !== 'Enter') return; const v = url.value.trim(); if (!v) return; url.blur(); const r = await bridge.browser.nav(S.view, v); if (!r.ok) flash(r.error || 'Could not open that.'); } });
  const take = h('button', { class: 'bw-btn bw-take', type: 'button', onclick: () => toggleControl() }, 'Take over');
  const tabsBox = h('div', { class: 'bw-tabs', role: 'tablist', 'aria-label': 'Tabs' });
  const canvas = h('canvas', { class: 'bw-canvas', width: 1280, height: 800, tabindex: 0, 'aria-label': 'Live view of the Orbit Browser' }), g = canvas.getContext('2d');
  const empty = h('div', { class: 'bw-empty' }, h('b', {}, 'Nothing is open yet'), h('span', {}, 'Ask Laila to open a page, or type an address above. This is Orbit\u2019s own browser: your Chrome, your logins and your history are never used.'));
  const banner = h('div', { class: 'bw-banner', hidden: true }), veil = h('div', { class: 'bw-veil', hidden: true }, 'Click the page to take over');
  const stage = h('div', { class: 'bw-stage' }, canvas, empty, banner, veil);
  const foot = h('div', { class: 'bw-foot' }, 'Private to Orbit. Cookies, logins and downloads stay inside this browser. Downloads land in Workspace / browser-downloads.');
  const main = h('div', { class: 'bw-main' }, h('div', { class: 'bw-bar' }, ctxSel, back, fwd, reload, url, take), tabsBox, stage, foot);

  const actBox = h('div', { class: 'bw-act' });
  const approve = h('select', { 'aria-label': 'Approvals', onchange: e => save({ browserApproval: e.target.value }) }, h('option', { value: 'sensitive' }, 'Ask before sensitive actions'), h('option', { value: 'strict' }, 'Ask before every click and field'));
  const iso = h('select', { 'aria-label': 'Browsers per worker', onchange: e => save({ browserIsolation: e.target.value }) }, h('option', { value: 'shared' }, 'One shared browser'), h('option', { value: 'per-agent' }, 'A separate browser per crew member'));
  const local = h('input', { type: 'checkbox', onchange: e => save({ browserAllowLocal: e.target.checked }) });
  const autoBox = h('input', { type: 'checkbox', onchange: e => localStorage.setItem('bw.auto', e.target.checked ? '1' : '0') }); autoBox.checked = localStorage.getItem('bw.auto') !== '0';
  const crewOut = h('div', { class: 'bw-steps' }), crewBtn = h('button', { class: 'bw-btn', type: 'button', style: 'align-self:flex-start', onclick: () => checkCrew() }, 'Check crew access');
  const clearBtn = h('button', { class: 'bw-btn', type: 'button', style: 'align-self:flex-start', onclick: async () => { if (confirm('Delete every cookie, login and cached file of this browser?')) { await bridge.browser.clear(S.view); flash('Browser data cleared.'); } } }, 'Clear cookies and data');
  const side = h('aside', { class: 'bw-side' },
    h('div', {}, h('h3', {}, 'Activity'), actBox),
    h('div', { class: 'bw-set' }, h('h3', {}, 'Rules'), h('label', {}, 'Approvals', approve), h('small', {}, 'Buying, sending, publishing, deleting and cloud changes always ask. Signing in, passwords, codes and card numbers are only ever typed by you.'),
      h('label', {}, 'Separate browsers', iso), h('label', { class: 'row' }, local, 'Open localhost and network addresses without asking'),
      h('label', { class: 'row' }, autoBox, 'Show this screen when the AI opens a page'), clearBtn),
    h('div', { class: 'bw-set' }, h('h3', {}, 'Crew access'), h('small', {}, 'Crew members use this same browser through a private link on this computer. Run the check once: it also switches off Hermes\u2019s own browser so nobody opens a normal Chrome.'), crewBtn, crewOut));
  const root = h('section', { id: 'browser', 'aria-label': 'Browser' }, h('div', { class: 'bw-wrap' }, main, side));
  document.body.append(root);

  /* ---------- state ---------- */
  const cur = () => S.ctxs.find(c => c.id === S.view) || null;
  let flashT = null; function flash(msg) { foot.textContent = msg; clearTimeout(flashT); flashT = setTimeout(() => { foot.textContent = 'Private to Orbit. Cookies, logins and downloads stay inside this browser. Downloads land in Workspace / browser-downloads.'; }, 4500); }
  function selectCtx(id) { S.view = id; localStorage.setItem('bw.ctx', id); if (S.active) bridge.browser.watch(id); paint(); }
  async function toggleControl() { const c = cur(); if (!c) { flash('Nothing is open in this browser yet.'); return; } if (c.handoff && c.userControl) { await bridge.browser.resume(S.view, true); } else await bridge.browser.takeover(S.view, !c.userControl); canvas.focus(); }
  async function save(p) { const r = await bridge.browser.settings(p); if (r.ok) { S.settings = r.settings; paintSettings(); } }
  async function checkCrew() {
    crewBtn.disabled = true; crewBtn.textContent = 'Checking\u2026'; crewOut.textContent = ''; const r = await bridge.browser.crewCheck(); crewBtn.disabled = false; crewBtn.textContent = 'Check crew access';
    if (!r.ok && !r.steps) { crewOut.append(h('div', { class: 'no' }, r.error || 'The check could not run.')); return; }
    for (const s of r.steps) crewOut.append(h('div', { class: s.ok ? 'yes' : 'no' }, s.name, s.detail ? h('small', {}, s.detail) : null));
    crewOut.append(h('div', { class: r.ok ? 'yes' : 'no' }, r.ok ? 'The crew can use the Orbit Browser.' : 'The crew cannot use the Orbit Browser yet.')); refresh();
  }

  /* ---------- painting ---------- */
  function paint() {
    const ids = new Set(['orbit', ...S.ctxs.map(c => c.id)]); if (!ids.has(S.view)) S.view = 'orbit';
    ctxSel.textContent = ''; for (const id of ids) ctxSel.append(h('option', { value: id, selected: id === S.view }, NICE_CTX(id))); ctxSel.hidden = ids.size < 2;
    const c = cur(), t = c && c.tabs.find(x => x.id === c.viewTab); take.classList.toggle('on', !!(c && c.userControl)); take.textContent = c && c.userControl ? (c.handoff ? 'I\u2019m done' : 'Give back') : 'Take over'; take.disabled = !c;
    if (document.activeElement !== url) url.value = t ? (t.url === 'about:blank' ? '' : t.url) : ''; back.disabled = reload.disabled = fwd.disabled = !t;
    tabsBox.textContent = ''; if (c) { for (const x of c.tabs) tabsBox.append(h('div', { class: 'bw-tab' + (x.id === c.viewTab ? ' cur' : '') + (x.loading ? ' load' : ''), role: 'tab', 'aria-selected': String(x.id === c.viewTab), title: x.url, onclick: () => bridge.browser.tab(S.view, 'view', x.id) }, h('span', { class: 't' }, x.title || host(x.url) || 'New tab'), x.owner !== 'commander' && c.tabs.some(y => y.owner !== x.owner) ? h('i', { class: 'who' }, x.ownerName) : null, h('button', { type: 'button', title: 'Close tab', onclick: e => { e.stopPropagation(); bridge.browser.tab(S.view, 'close', x.id); } }, '\u00D7'))); tabsBox.append(h('button', { class: 'bw-btn bw-follow', type: 'button', title: 'Open another tab', onclick: () => { bridge.browser.tab(S.view, 'new'); setTimeout(() => url.focus(), 250); } }, '+')); if (c.pinned) tabsBox.append(h('button', { class: 'bw-btn bw-follow', type: 'button', onclick: () => bridge.browser.tab(S.view, 'unpin') }, 'Follow the AI')); }
    empty.hidden = !!(t && t.url && t.url !== 'about:blank') || S.hasFrame; if (!t) S.hasFrame = false;
    stage.classList.toggle('ctl', !!(c && c.userControl)); veil.hidden = !(t && !(c && c.userControl));
    if (c && c.handoff) { banner.hidden = false; banner.className = 'bw-banner need'; banner.textContent = ''; banner.append(h('span', { class: 'sp' }, h('b', {}, c.handoff.actorName + ' needs you. '), c.handoff.reason, ' Do it in the page below, then press \u201CI\u2019m done\u201D.'), h('button', { class: 'bw-btn', type: 'button', onclick: () => bridge.browser.resume(S.view, true) }, 'I\u2019m done'), h('button', { class: 'bw-btn', type: 'button', onclick: () => bridge.browser.resume(S.view, false) }, 'Not now')); }
    else if (c && c.userControl) { banner.hidden = false; banner.className = 'bw-banner'; banner.textContent = ''; banner.append(h('span', { class: 'sp' }, 'You are in control. The AI waits; it carries on when you press Give back, leave this screen, or stop for 45 seconds.')); }
    else banner.hidden = true;
    paintActivity();
  }
  function paintActivity() {
    actBox.textContent = ''; const list = S.activity.filter(e => !S.view || e.ctx === S.view || !e.ctx).slice(-40).reverse();
    if (!list.length) actBox.append(h('div', { class: 'bw-none' }, 'Nothing yet. Every step the AI takes here is listed.'));
    for (const e of list) actBox.append(h('div', { class: 'bw-a ' + e.status, title: e.detail || '' }, h('time', {}, clock(e.t).slice(0, 5)), h('div', {}, h('b', {}, e.actorName || e.actor), ' ', e.action, e.status === 'ok' ? '' : ' \u00B7 ' + ({ asked: 'asked you', human: 'needs you', denied: 'refused', error: 'failed' }[e.status] || e.status)), h('small', {}, e.detail || e.target)));
  }
  function paintSettings() { const s = S.settings; approve.value = s.browserApproval || 'sensitive'; iso.value = s.browserIsolation || 'shared'; local.checked = !!s.browserAllowLocal; }
  function draw(f) {
    if (f.ctx !== S.view) return; S.hasFrame = true; const im = new Image();
    im.onload = () => { if (canvas.width !== f.w || canvas.height !== f.h) { canvas.width = f.w; canvas.height = f.h; } g.drawImage(im, 0, 0); if (!empty.hidden) empty.hidden = true; }; im.src = 'data:image/jpeg;base64,' + f.jpeg;
  }
  async function refresh() { const r = await bridge.browser.state(); if (!r.ok) return; S.ctxs = r.state.contexts; S.activity = r.activity; S.settings = r.settings; S.mcpPort = r.mcpPort; paintSettings(); paint(); }

  /* ---------- you, in the page ---------- */
  const pt = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; };
  const inControl = () => { const c = cur(); return !!(c && c.userControl); };
  const send = ev => bridge.browser.input(S.view, ev);
  const BTN = ['left', 'middle', 'right'];
  canvas.addEventListener('mousedown', async e => { if (!inControl()) { e.preventDefault(); await toggleControl(); return; } canvas.focus(); const p = pt(e); send({ kind: 'mouse', type: 'down', ...p, button: BTN[e.button] || 'left', clickCount: e.detail || 1 }); e.preventDefault(); });
  addEventListener('mouseup', e => { if (!inControl() || S.downOn !== canvas) return; }); canvas.addEventListener('mouseup', e => { if (!inControl()) return; const p = pt(e); send({ kind: 'mouse', type: 'up', ...p, button: BTN[e.button] || 'left', clickCount: e.detail || 1 }); e.preventDefault(); });
  let lastMove = 0; canvas.addEventListener('mousemove', e => { if (!inControl()) return; const n = performance.now(); if (n - lastMove < 40) return; lastMove = n; send({ kind: 'mouse', type: 'move', ...pt(e) }); });
  let wheelAcc = 0, wheelT = null; canvas.addEventListener('wheel', e => { if (!inControl()) return; e.preventDefault(); wheelAcc += e.deltaY; if (wheelT) return; wheelT = setTimeout(() => { const p = pt(e); send({ kind: 'mouse', type: 'wheel', ...p, deltaX: 0, deltaY: -Math.round(wheelAcc) }); wheelAcc = 0; wheelT = null; }, 30); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  const mods = e => [e.shiftKey && 'shift', e.ctrlKey && 'control', e.altKey && 'alt', e.metaKey && 'meta'].filter(Boolean);
  canvas.addEventListener('keydown', e => { if (!inControl()) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return; e.preventDefault(); send({ kind: 'key', type: 'down', key: e.key, modifiers: mods(e) }); });
  canvas.addEventListener('keyup', e => { if (!inControl()) return; e.preventDefault(); send({ kind: 'key', type: 'up', key: e.key, modifiers: mods(e) }); });
  canvas.addEventListener('paste', e => { if (!inControl()) return; e.preventDefault(); const t = e.clipboardData && e.clipboardData.getData('text'); if (t) send({ kind: 'text', text: t }); });

  /* ---------- events from the app ---------- */
  let paintT = null; const later = () => { if (!S.active) return; clearTimeout(paintT); paintT = setTimeout(paint, 60); };
  bridge.onBus(({ type, payload }) => {
    if (type === 'browser:frame') { if (S.active) draw(payload); }
    else if (type === 'browser:state') { S.ctxs = payload.contexts; later(); }
    else if (type === 'browser:activity') { S.activity.push(payload); if (S.activity.length > 200) S.activity.shift(); later(); aiActive(payload); }
    else if (type === 'browser:handoff') { S.view = payload.ctx; S.ctxs = S.ctxs; if (window.__ws) __ws.show('browser'); refresh(); }
  });
  // The AI opens a page: bring the Browser screen up (only from Orbit or Office, never over Workspace edits), unless you left it on purpose in the last 30 s.
  let lastLeave = 0;
  function aiActive(e) {
    if (!e || e.actor === 'user' || e.action !== 'open' || e.status !== 'ok' || e.background || localStorage.getItem('bw.auto') === '0') return;   // a page opened in the background does not take over the screen
    if (Date.now() - lastLeave < 30000) return;
    const v = document.body.dataset.view; if ((v === 'bridge' || v === 'office') && window.__ws) { S.view = e.ctx || S.view; __ws.show('browser'); }
  }
  function enter() { S.active = true; S.hasFrame = false; S.view = localStorage.getItem('bw.ctx') || S.view; refresh().then(() => bridge.browser.watch(S.view)); }
  function leave() { S.active = false; lastLeave = Date.now(); bridge.browser.watch(null); for (const c of S.ctxs) if (c.userControl && !c.handoff) bridge.browser.takeover(c.id, false); }   // walking away gives the browser back to the AI
  window.__browser = { enter, leave, state: () => S };
})();
