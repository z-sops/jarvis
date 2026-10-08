/* "This computer": processor, memory, graphics card, disk, and what Orbit itself uses. Live while the home screen is showing. */
(() => {
  'use strict';
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (v !== false && v != null) el.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return el; };
  let card = null, on = false; const R = {};
  const row = (id, label) => { const v = h('span', { class: 'sm-v' }, '\u2026'), i = h('i'), bar = h('div', { class: 'sm-bar' }, i), el = h('div', { class: 'sm-row', 'data-row': id }, h('span', { class: 'sm-l' }, label), bar, v); R[id] = { el, i, v }; return el; };
  function build() {
    const panel = document.querySelector('.panel.sys'); if (!panel || card) return !!card;
    card = h('div', { class: 'sysmon', 'aria-label': 'This computer' }, h('div', { class: 'sm-title' }, 'This computer'), row('cpu', 'CPU'), row('mem', 'Memory'), row('gpu', 'Graphics'), row('disk', 'Disk'), row('disk2', 'Disk'), h('div', { class: 'sm-orbit', id: 'sm-orbit' }));
    (panel.querySelector('.quickrun') || panel.querySelector('.ph')).after(card); return true;   // below Quick Run when it is there
  }
  const level = p => (p >= 85 ? 'hot' : p >= 65 ? 'warm' : 'ok');
  function set(id, p, text, title) { const r = R[id]; if (!r) return; r.i.style.width = Math.max(2, Math.min(100, p || 0)) + '%'; r.el.dataset.level = p == null ? 'none' : level(p); r.v.textContent = text; r.el.title = title || ''; }
  function paint(s) {
    if (!build()) return;
    set('cpu', s.cpu.pct, `${s.cpu.pct}%`, `${s.cpu.cores} cores${s.cpu.model ? ' \u00B7 ' + s.cpu.model : ''}`);
    set('mem', s.mem.pct, `${s.mem.usedGB} / ${s.mem.totalGB} GB`, `${s.mem.pct}% of the memory is in use`);
    if (s.gpu) { const g = s.gpu, vram = g.memTotalMB ? `${(g.memUsedMB / 1024).toFixed(1)}/${(g.memTotalMB / 1024).toFixed(1)} GB` : '', parts = [g.pct != null ? g.pct + '%' : '', vram, g.temp != null ? g.temp + '\u00B0C' : ''].filter(Boolean); set('gpu', g.pct != null ? g.pct : (g.memTotalMB ? Math.round(g.memUsedMB / g.memTotalMB * 100) : null), parts.join(' \u00B7 ') || 'active', `${g.name || 'Graphics card'} (${g.source})`); }
    else set('gpu', null, 'not available', 'Needs NVIDIA drivers (nvidia-smi) or Windows 10 or newer.');
    if (s.disk) set('disk', s.disk.pct, `${s.disk.freeGB} GB free`, `${s.disk.freeGB} GB free of ${s.disk.totalGB} GB (${s.disk.path})`); else set('disk', null, '\u2014', '');
    const ds = s.disks && s.disks.length ? s.disks : (s.disk ? [{ ...s.disk, label: '' }] : []);
    ['disk', 'disk2'].forEach((id, i) => { const d = ds[i], r = R[id]; if (!r) return; r.el.style.display = d || i === 0 ? '' : 'none'; if (!d) { set(id, null, '\u2014', ''); return; } r.el.querySelector('.sm-l').textContent = d.label ? 'Disk ' + d.label : 'Disk'; set(id, d.pct, `${d.freeGB} GB free`, `${d.freeGB} GB free of ${d.totalGB} GB (${d.path})${d.role === 'orbit' ? ' \u00B7 where Orbit keeps its data' : ''}`); });
    const o = document.getElementById('sm-orbit'); if (o) o.textContent = s.orbit ? `Orbit itself: ${s.orbit.cpu}% CPU \u00B7 ${s.orbit.memMB} MB \u00B7 ${s.orbit.processes} processes` : '';
  }
  // Only measured while you can see it.
  const want = () => document.body.dataset.view === 'bridge' && document.body.classList.contains('phase-bridge') && !document.hidden;
  function tick() { const w = want(); if (w === on) return; on = w; bridge.sys.watch(w); if (w) bridge.sys.once().then(r => r.ok && paint(r.sample)); }
  bridge.onBus(({ type, payload }) => { if (type === 'sys:stats') paint(payload); });
  setInterval(tick, 1000); document.addEventListener('visibilitychange', tick);
  window.__sysmon = { paint, build };
})();
