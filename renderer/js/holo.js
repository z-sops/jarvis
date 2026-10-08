/* The holographic look: applies it, renames the panels in plain words, and shows the crew as a clean list. */
(() => {
  'use strict';
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'style') el.style.cssText = v; else if (v !== false && v != null) el.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return el; };
  const NAMES = { '.panel.crew .ph h2': 'Crew', '.panel.comms .ph h2': 'Conversation', '.panel.sys .ph h2': 'Status' };
  const HUES = ['104,208,255', '255,190,92', '150,140,255', '110,230,170', '255,130,150', '120,190,255'];
  let holo = false, list = null, timer = null, agents = [];
  const $ = s => document.querySelector(s);

  function rename(on) { for (const [sel, name] of Object.entries(NAMES)) { const el = $(sel); if (!el) continue; if (el.dataset.orig == null) el.dataset.orig = el.textContent; el.textContent = on ? name : el.dataset.orig; } }
  const hue = id => HUES[[...String(id)].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];
  const stateText = a => (a.state === 'working' ? 'Working' : a.state === 'idle' || !a.state ? 'Idle' : String(a.state).replace(/^./, c => c.toUpperCase()));

  function paint() {
    if (!list) return; list.textContent = '';
    const name = ($('#hud-name') || {}).textContent || 'Assistant', status = ($('#hud-status') || {}).textContent || '';
    list.append(h('button', { class: 'cl-item live', type: 'button', onclick: () => { const m = $('#msg'); if (m) m.focus(); } }, h('span', { class: 'cl-av', style: '--c:104,208,255' }, name[0] ? name[0].toUpperCase() : 'A'), h('div', { class: 'cl-txt' }, h('b', {}, name.replace(/^./, c => c.toUpperCase())), h('small', {}, 'Your assistant')), h('span', { class: 'cl-st' }, status || 'Ready')));
    if (!agents.length) list.append(h('div', { class: 'cl-empty' }, 'No crew yet. Press "Add crew" to hire one: a coder, a researcher, a writer.'));
    for (const a of agents) list.append(h('button', { class: 'cl-item' + (a.state === 'working' ? ' working' : ''), type: 'button', title: 'Open the office', onclick: () => { if (window.__ws) __ws.show('office'); } },
      h('span', { class: 'cl-av', style: `--c:${hue(a.id)}` }, (a.name || '?')[0].toUpperCase()), h('div', { class: 'cl-txt' }, h('b', {}, a.name), h('small', {}, a.state === 'working' && a.task ? String(a.task).slice(0, 80) : (a.role || 'Crew'))), h('span', { class: 'cl-st' }, stateText(a))));
  }
  async function refresh() { if (!holo || document.hidden || document.body.dataset.view !== 'bridge') return; try { agents = await bridge.agents.list(); } catch { return; } paint(); }
  function start() {
    if (list) return; const panel = $('.panel.crew'); if (!panel) return; list = h('div', { id: 'crew-list', role: 'list', 'aria-label': 'Crew' }); const ph = panel.querySelector('.ph'); ph.after(list);
    const st = $('#hud-status'); if (st) new MutationObserver(() => paint()).observe(st, { childList: true, characterData: true, subtree: true });
    bridge.onBus(({ type }) => { if (/^(agent|job)/.test(type)) setTimeout(refresh, 150); });
    timer = setInterval(refresh, 4000); refresh();
  }
  function apply(cfg) {
    holo = !(cfg && cfg.classicLook); document.body.dataset.look = holo ? 'holo' : 'classic'; rename(holo); if (holo) { start(); refresh(); }
  }
  window.__holo = { apply, refresh };
  Promise.resolve().then(() => bridge.config.get()).then(apply).catch(() => apply({}));
})();
