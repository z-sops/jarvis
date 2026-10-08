/* Office: the crew's floor, full screen. Agents sit at desks while they work, walk to the Archive when they save files,
   to Comms when they use the web, to Engineering for commands, and rest in the Lounge. Click one to see what they are doing.
   The rules of the floor plan live in office-core.js; this file draws it and listens to what the crew does. */
(function () {
  'use strict';
  if (!window.bridge || !window.OfficeCore) return;
  const O = window.OfficeCore, COMMANDER = 'jarvis';
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v); } for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid)); return el; };
  const NICE = { run_shell: 'Running a command', write_file: 'Writing a file', read_file: 'Reading a file', list_dir: 'Looking in a folder', web_search: 'Searching the web', browser_open: 'Opening a web page', browser_read: 'Reading a web page', browser_click: 'Clicking on a web page', browser_type: 'Typing on a web page', browser_select: 'Using a web page', browser_press: 'Using a web page', browser_scroll: 'Scrolling a web page', browser_nav: 'Using a web page', browser_tabs: 'Using browser tabs', browser_wait: 'Waiting for a web page', open_url: 'Opening a page', look_at_screen: 'Looking at the screen', assign_task: 'Giving out a job', cancel_job: 'Stopping a job', create_agent: 'Adding crew', get_system_info: 'Checking the system', remember: 'Making a note', list_jobs: 'Checking jobs', get_job: 'Reading a report' };
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '\u2026' : s);
  const now = () => performance.now() / 1000;
  const state = { agents: new Map(), files: new Map(), total: 0, sel: null, hover: null, visible: false, aiName: 'Laila', cmd: { x: 25, y: 15, mode: 'idle', bubble: '', until: 0 }, k: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1, last: 0, t: 0 };

  /* ---------- page ---------- */
  const canvas = h('canvas', { id: 'of-canvas', role: 'img', 'aria-label': 'The crew office' });
  const stats = h('div', { class: 'of-stats' }), hint = h('div', { class: 'of-hint' }, 'Click someone to see what they are doing');
  const back = h('button', { class: 'of-back', type: 'button', onclick: () => window.__ws && __ws.show('bridge') }, '\u2190 Orbit');
  const stage = h('div', { class: 'of-stage' }, canvas, back, stats, hint), side = h('aside', { class: 'of-side', 'aria-label': 'Crew details' });
  const root = h('section', { id: 'office', 'aria-label': 'Office' }, h('div', { class: 'of-wrap' }, stage, side));
  document.body.append(root); const ctx = canvas.getContext('2d');

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = stage.clientWidth, hh = stage.clientHeight; if (!w || !hh) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); canvas.style.width = w + 'px'; canvas.style.height = hh + 'px';
    Object.assign(state, { dpr, w, h: hh, k: Math.min(w / O.W, hh / O.H) }); state.ox = (w - O.W * state.k) / 2; state.oy = (hh - O.H * state.k) / 2;
  }
  new ResizeObserver(resize).observe(stage);

  /* ---------- data ---------- */
  async function loadAgents() {
    let list = []; try { list = await bridge.agents.list(); } catch { return; }
    try { const c = await bridge.config.get(); state.aiName = c.aiName || 'Laila'; } catch { /* keep the old name */ }
    const seen = new Set();
    for (const a of list) {
      seen.add(a.id); let o = state.agents.get(a.id), st = a.station || 0;
      if (!o) { const p = a.state === 'working' ? O.seat(st) : O.spot('lounge', st); o = { id: a.id, x: p[0], y: p[1], station: st, state: 'idle' }; state.agents.set(a.id, o); }
      Object.assign(o, { name: a.name, role: a.role, color: a.color || '#6fe3e0', station: st, task: a.task || '' }); o.state = a.state === 'working' ? 'working' : 'idle';
    }
    for (const id of [...state.agents.keys()]) if (!seen.has(id)) state.agents.delete(id);
    if (state.snap) {
      // The floor only animates while this tab is open, so after time away people can be stale. Put them where they belong now.
      state.snap = false;
      for (const o of state.agents.values()) { const p = o.state === 'working' ? O.seat(o.station) : O.spot('lounge', o.station); o.x = p[0]; o.y = p[1]; o.path = []; o.dest = null; o.destArrived = null; o.goalKey = null; o.moving = false; o.wander = null; }
    }
    paintSide(); paintStats();
  }
  async function loadFiles() {
    let r; try { r = await bridge.workspace.tree(); } catch { return; } if (!r || !r.ok) return;
    const flat = (list, out = []) => { for (const n of list) n.dir ? flat(n.children || [], out) : out.push(n); return out; };
    state.files = new Map(); let total = 0;
    for (const e of r.entries) { const list = e.dir ? flat(e.children || []) : [e]; total += list.length; const id = e.dir && e.agent ? e.agent.id : COMMANDER; state.files.set(id, (state.files.get(id) || []).concat(list)); }
    for (const [k, v] of state.files) state.files.set(k, v.sort((a, b) => b.mtime - a.mtime)); state.total = total; paintStats(); if (state.sel) paintSide();
  }
  let listTimer = null; const crewListSoon = () => { if (!listTimer) listTimer = setTimeout(() => { listTimer = null; if (!state.sel && state.visible) paintSide(); }, 800); };
  function note(id, tool, label) {
    const o = state.agents.get(id); if (!o) return; const t = now();
    o.label = clip(String(label || NICE[tool] || tool || '').replace(/[_-]+/g, ' '), 40); o.labelUntil = t + 6;
    const d = O.destFor(tool) || O.destFor(label); if (d && o.state === 'working') O.visit(o, d, t);
  }
  bridge.onBus(({ type, payload: p }) => {
    if (type === 'agent:state') { const o = state.agents.get(p.id); if (o) { o.state = p.state === 'working' ? 'working' : 'idle'; o.task = p.task || ''; if (o.state !== 'working') o.label = ''; paintStats(); if (state.sel === p.id || !state.sel) paintSide(); } }
    else if (type === 'agent:created' || type === 'agent:updated') loadAgents();
    else if (type === 'job:progress') { if (p && p.agent) { note(p.agent.id, p.tool, p.label); if (!state.sel) crewListSoon(); } }
    else if (type === 'tool') { if (p.status === 'start') { if (p.actor === 'commander') { state.cmd.bubble = NICE[p.name] || p.name; state.cmd.until = now() + 5; } else note(p.actor, p.name); } }
    else if (type === 'job:done' || type === 'job:reviewed') { const o = state.agents.get(p.agent.id); if (o) { o.label = ''; o.flash = { text: p.job.status === 'review' ? 'Review' : p.job.status === 'done' ? 'Accepted' : p.job.status === 'cancelled' ? 'Stopped' : 'Problem', tone: p.job.status === 'done' || p.job.status === 'review' ? 'ok' : 'bad', until: now() + 5 }; } loadFiles(); if (state.sel === p.agent.id) paintSide(); }
    else if (type === 'ws:changed') loadFiles();
  });
  setInterval(() => { const s = ((document.getElementById('hud-status') || {}).textContent || '').toLowerCase(); state.cmd.mode = /speak/.test(s) ? 'speaking' : /listen/.test(s) ? 'listening' : /work|think/.test(s) ? 'working' : 'idle'; }, 400);

  /* ---------- drawing ---------- */
  const font = (px, weight = '') => `${weight} ${Math.max(8, px)}px "Bahnschrift","Segoe UI",sans-serif`.trim(), mono = px => `${Math.max(8, px)}px "Cascadia Mono",Consolas,monospace`;
  const P = (x, y) => [state.ox + x * state.k, state.oy + y * state.k];
  function rect(x, y, w, hh, fill, stroke, lw = 1, r = 0) {
    const [px, py] = P(x, y), k = state.k; ctx.beginPath(); r ? ctx.roundRect(px, py, w * k, hh * k, r * k) : ctx.rect(px, py, w * k, hh * k);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }
  function circle(x, y, r, fill, stroke, lw = 1) { const [px, py] = P(x, y); ctx.beginPath(); ctx.arc(px, py, r * state.k, 0, Math.PI * 2); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } }
  const CY = 'rgba(111,227,224,', AM = 'rgba(255,178,62,';
  const inRoom = room => [...state.agents.values()].filter(o => O.roomAt(o.x, o.y) === room), busyIn = room => inRoom(room).some(o => o.state === 'working');

  function scene(t) {
    const k = state.k; ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0); ctx.clearRect(0, 0, state.w, state.h);
    // deck plating and grid
    ctx.strokeStyle = 'rgba(111,227,224,0.045)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= O.W; x += 8) { const [a, b] = P(x, 0), [c, d] = P(x, O.H); ctx.moveTo(a, b); ctx.lineTo(c, d); } for (let y = 0; y <= O.H; y += 8) { const [a, b] = P(0, y), [c, d] = P(O.W, y); ctx.moveTo(a, b); ctx.lineTo(c, d); } ctx.stroke();
    // hallway
    rect(4, 38, 152, 14, '#0A1119', 'rgba(220,216,204,0.10)'); const [ha, hb] = P(8, O.HALL_Y), [hc] = P(152, O.HALL_Y);
    ctx.setLineDash([k * 1.6, k * 1.6]); ctx.strokeStyle = AM + '0.22)'; ctx.beginPath(); ctx.moveTo(ha, hb); ctx.lineTo(hc, hb); ctx.stroke(); ctx.setLineDash([]);
    // rooms
    for (const [id, r] of Object.entries(O.ROOMS)) {
      const busy = busyIn(id); rect(r.x, r.y, r.w, r.h, '#0D1521', busy ? CY + '0.6)' : CY + '0.26)', busy ? 1.6 : 1.1);
      if (busy) { const [px, py] = P(r.x, r.y); const g = ctx.createLinearGradient(0, py, 0, py + r.h * k); g.addColorStop(0, CY + '0.07)'); g.addColorStop(1, CY + '0)'); ctx.fillStyle = g; ctx.fillRect(px, py, r.w * k, r.h * k); }
      ctx.fillStyle = 'rgba(137,148,166,0.85)'; ctx.font = mono(k * 1.8); ctx.textBaseline = 'top'; ctx.textAlign = 'left'; const [lx, ly] = P(r.x + 1.2, id === 'desks' || id === 'lounge' ? r.y + 1 : r.y + r.h - 3.4); ctx.fillText(r.name.toUpperCase(), lx, ly);
      const d = O.doorPoint(r); rect(d[0] - 3, d[1] - 0.7, 6, 1.4, AM + '0.45)');
    }
    // Command: holo table
    const pulse = 0.5 + 0.5 * Math.sin(t * 2); circle(25, 25, 6.2, '#101c2b', CY + '0.5)'); circle(25, 25, 4 + pulse * 1.4, null, CY + (0.15 + pulse * 0.25) + ')'); circle(25, 25, 1.4, CY + (0.5 + pulse * 0.3) + ')');
    rect(9, 9, 6.5, 3, '#132033', CY + '0.3)', 1, 0.5); rect(34, 9, 6.5, 3, '#132033', CY + '0.3)', 1, 0.5); rect(10, 10, 4.5, 1, CY + '0.5)'); rect(35, 10, 4.5, 1, AM + '0.5)');
    // Archive: shelves that fill as the workspace fills
    const shown = Math.min(30, state.total), rows = 6; for (let i = 0; i < rows; i++) { const x = 51 + i * 5.3; rect(x, 8, 4.2, 10, '#132033', CY + '0.3)', 1, 0.4); const n = Math.max(0, Math.min(5, shown - i * 5)); for (let j = 0; j < 5; j++) rect(x + 0.7, 9 + j * 1.8, 2.8, 1.1, j < n ? (j % 2 ? AM + '0.75)' : CY + '0.7)') : 'rgba(255,255,255,0.05)'); }
    ctx.fillStyle = 'rgba(137,148,166,0.7)'; ctx.font = mono(k * 1.5); const [fx, fy] = P(51, 19.6); ctx.fillText(`${state.total} FILE${state.total === 1 ? '' : 'S'}`, fx, fy);
    // Comms: dish and consoles
    const wave = busyIn('comms') ? 1 : 0.25; circle(105, 15, 4.8, '#101c2b', CY + '0.5)'); circle(105, 15, 1.2, CY + '0.8)'); for (let i = 0; i < 3; i++) { const rr = 6.5 + i * 2.6 + ((t * 3) % 2.6) * wave; circle(105, 15, rr, null, CY + (0.22 * wave * (1 - i * 0.28)) + ')'); }
    rect(92, 9, 8, 3, '#132033', CY + '0.3)', 1, 0.5); rect(110, 9, 8, 3, '#132033', CY + '0.3)', 1, 0.5); rect(93, 10, 6, 1, CY + '0.5)'); rect(111, 10, 6, 1, AM + '0.5)');
    // Engineering: racks with blinking lights
    const eng = busyIn('engineering') ? 9 : 2; for (let i = 0; i < 4; i++) { const x = 130 + i * 5.6; rect(x, 8, 4.4, 15, '#132033', CY + '0.3)', 1, 0.4); for (let j = 0; j < 6; j++) { const on = Math.sin(t * eng + i * 1.7 + j * 2.3) > 0.2; rect(x + 0.8, 9.2 + j * 2.2, 2.8, 1, on ? (j % 3 ? CY + '0.85)' : AM + '0.85)') : 'rgba(255,255,255,0.07)'); } }
    // Open office: twelve desks, lit when the person at them is working
    for (let i = 0; i < 12; i++) {
      const [cx, cy] = O.deskCenter(i), who = [...state.agents.values()].find(o => (o.station % 12) === i), working = who && who.state === 'working' && !who.moving && Math.hypot(who.x - O.seat(i)[0], who.y - O.seat(i)[1]) < 1;
      ctx.globalAlpha = who ? 1 : 0.42; rect(cx - 4.5, cy - 2.1, 9, 4.2, '#152233', CY + '0.3)', 1, 0.5);
      rect(cx - 2.5, cy - 1.5, 5, 1.6, working ? AM + (0.65 + 0.25 * Math.sin(t * 7 + i)) + ')' : CY + '0.22)'); circle(cx, cy + 4.6, 1.7, '#0E1622', 'rgba(137,148,166,0.35)'); ctx.globalAlpha = 1;
    }
    // Lounge
    rect(118, 78, 32, 5, '#142235', CY + '0.25)', 1, 1.2); rect(118, 56, 5, 18, '#142235', CY + '0.25)', 1, 1.2); circle(134, 68, 3.6, '#101c2b', AM + '0.3)'); circle(151, 56.5, 2, '#1d3d35', 'rgba(123,216,143,0.5)'); circle(117, 79, 1.4, '#1d3d35', 'rgba(123,216,143,0.5)');
  }

  function person(x, y, r, color, letter, name, hi, working, moving, t) {
    const [px, py] = P(x, y), k = state.k; ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(px, py + r * k * 0.9, r * k * 0.95, r * k * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    const bob = moving ? Math.sin(t * 14) * k * 0.25 : 0;
    if (working && !moving) { ctx.strokeStyle = color; ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 4); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py + bob, (r + 1.1 + Math.sin(t * 4) * 0.35) * k, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.fillStyle = '#060A10'; ctx.beginPath(); ctx.arc(px, py + bob, r * k, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = hi ? 3 : 2; ctx.stroke();
    ctx.fillStyle = color; ctx.font = font(r * k * 1.15, '600'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(letter || '?').toUpperCase(), px, py + bob + 1);
    ctx.font = font(k * 1.75); ctx.fillStyle = hi ? '#fff' : 'rgba(220,216,204,0.92)'; ctx.textBaseline = 'top'; ctx.fillText(name || '', px, py + bob + r * k + 3);
  }
  function bubble(x, y, text, tone) {
    if (!text) return; const [px, py] = P(x, y), k = state.k; ctx.font = font(k * 1.7); const w = ctx.measureText(text).width + k * 2.4, hh = k * 3.4, bx = Math.min(state.w - w - 6, Math.max(6, px - w / 2)), by = py - k * 2.4 - hh - k * 1.4;
    ctx.fillStyle = tone === 'bad' ? 'rgba(80,20,20,0.92)' : tone === 'ok' ? 'rgba(15,55,40,0.92)' : 'rgba(9,16,26,0.94)'; ctx.strokeStyle = tone === 'bad' ? 'rgba(255,90,79,0.8)' : tone === 'ok' ? 'rgba(123,216,143,0.8)' : AM + '0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx, by, w, hh, k * 0.9); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(px - k * 0.9, by + hh); ctx.lineTo(px, by + hh + k * 1.1); ctx.lineTo(px + k * 0.9, by + hh); ctx.fillStyle = ctx.strokeStyle; ctx.globalAlpha = 0.6; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#e7eaf0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + w / 2, by + hh / 2 + 1);
  }
  function actors(t) {
    // Laila at the command console
    const c = state.cmd, k = state.k, [cx, cy] = P(25, 15), lit = c.mode !== 'idle'; ctx.strokeStyle = lit ? AM + '0.65)' : CY + '0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, (4.6 + (lit ? 0.6 * Math.sin(t * 5) : 0.3 * Math.sin(t * 1.5))) * k, 0, Math.PI * 2); ctx.stroke();
    person(25, 15, 2.9, '#FFB23E', state.aiName[0], state.aiName, state.sel === COMMANDER || state.hover === COMMANDER, lit, false, t);
    const cb = c.until > t ? c.bubble : c.mode === 'speaking' ? 'Speaking' : c.mode === 'listening' ? 'Listening' : c.mode === 'working' ? 'Thinking\u2026' : ''; bubble(25, 15 - 2.9, cb);
    // the crew, back to front so nobody hides a name
    for (const o of [...state.agents.values()].sort((a, b) => a.y - b.y)) {
      person(o.x, o.y, 2.4, o.color, (o.name || '?')[0], o.name, state.sel === o.id || state.hover === o.id, o.state === 'working', o.moving, t);
      if (state.sel === o.id) { const [px, py] = P(o.x, o.y); ctx.setLineDash([k * 0.8, k * 0.8]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, (o.state === 'working' ? 4.6 : 3.8) * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    }
    for (const o of state.agents.values()) {
      const dots = '.'.repeat(1 + ((t * 2) | 0) % 3);
      if (o.flash && o.flash.until > t) bubble(o.x, o.y - 2.4, o.flash.text, o.flash.tone);
      else if (o.state === 'working') bubble(o.x, o.y - 2.4, o.label && o.labelUntil > t ? o.label : o.task ? clip(o.task, 30) : 'Thinking' + dots);
    }
    if (!state.agents.size) { ctx.fillStyle = 'rgba(137,148,166,0.9)'; ctx.font = font(k * 2.3); ctx.textAlign = 'center'; const [x, y] = P(58, 68); ctx.fillText('No crew yet.', x, y); ctx.font = font(k * 1.8); ctx.fillText('Ask ' + state.aiName + ' to add someone, or press "Add crew" on the Orbit.', x, y + k * 3.4); }
  }

  function loop(ts) {
    if (!state.visible) return; requestAnimationFrame(loop);
    const dt = Math.min(0.1, (ts - (state.last || ts)) / 1000); state.last = ts; state.t += dt; const t = now();
    for (const o of state.agents.values()) O.step(o, t, dt);
    if (state.w) { scene(t); actors(t); }
  }

  /* ---------- clicking ---------- */
  function hit(e) {
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, near = (x, y, rad) => { const [px, py] = P(x, y); return Math.hypot(mx - px, my - py) < rad * state.k; };
    for (const o of state.agents.values()) if (near(o.x, o.y, 3.4)) return o.id; return near(25, 15, 4) ? COMMANDER : null;
  }
  canvas.addEventListener('mousemove', e => { state.hover = hit(e); canvas.style.cursor = state.hover ? 'pointer' : 'default'; });
  canvas.addEventListener('mouseleave', () => { state.hover = null; });
  canvas.addEventListener('click', e => select(hit(e)));

  /* ---------- the side panel ---------- */
  const dot = st => h('i', { class: 'of-dot ' + st });
  const jobTone = s => (s === 'done' ? 'ok' : s === 'failed' ? 'bad' : s === 'cancelled' ? 'warn' : 'run');
  const jobLabel = j => j.status === 'review' ? 'Ready for review' : j.status === 'done' ? (j.acceptedAt ? 'Accepted by you' : 'Legacy completion (unverified)') : j.status === 'interrupted' ? 'Interrupted — inspect before retry' : j.status === 'queued' && j.recoveryNeeded ? 'Recovered queue — awaiting retry' : j.status;
  function jobCard(j) {
    const message = h('small', { role: 'status' });
    const act = (label, method) => h('button', { class: 'mini', type: 'button', onclick: async e => {
      const button = e.currentTarget; button.disabled = true; message.textContent = 'Saving…';
      try { const r = await method(); if (!r || !r.ok) throw new Error(r && r.error || 'The job action failed.'); await paintSide(); }
      catch (err) { message.textContent = err.message || String(err); button.disabled = false; }
    } }, label);
    const actions = [];
    if (bridge.jobs && j.status === 'review') actions.push(act('Accept result', () => bridge.jobs.review(j.id, 'accept')), act('Reject result', () => bridge.jobs.review(j.id, 'reject')));
    if (bridge.jobs && (['interrupted', 'failed', 'cancelled', 'rejected'].includes(j.status) || j.status === 'queued' && j.recoveryNeeded)) actions.push(act('Retry job', () => {
      if (!window.confirm('Retry this job? Inspect existing files first. An earlier external action may already have happened.')) return Promise.resolve({ ok: true });
      return bridge.jobs.retry(j.id);
    }));
    const v = j.verification;
    const evidenceText = v ? v.status === 'files_checked' ? (j.status === 'done' ? 'Requested files checked and accepted by you. Correctness was decided in human review.' : 'Requested files checked. Review their correctness before accepting.') : v.status === 'failed' ? 'Output checks failed: ' + v.issues.map(i => (i.path ? i.path + ': ' : '') + i.reason).join(' ') : j.status === 'done' ? 'You accepted the report. No automatic artifact checks were requested.' : 'Worker report is unverified. Review before accepting.' : '';
    return h('details', { class: 'of-job', 'data-job-id': j.id },
      h('summary', {}, dot(jobTone(j.status)), h('span', {}, clip(String(j.task || ''), 70))),
      h('p', { class: 'of-job-state' }, jobLabel(j)),
      h('p', {}, j.result ? clip(String(j.result), 700) : j.status === 'running' ? 'Still working on it.' : j.status === 'queued' ? 'Waiting in line.' : 'No report.'),
      j.error ? h('p', {}, j.error) : null, evidenceText ? h('p', {}, evidenceText) : null,
      v && v.artifacts.length ? h('ul', {}, v.artifacts.map(a => h('li', {}, `${a.path} · ${a.bytes} bytes · SHA-256 ${a.sha256.slice(0, 12)}…`))) : null,
      h('div', { class: 'of-actions' }, actions), message);
  }
  function paintStats() { const list = [...state.agents.values()], working = list.filter(o => o.state === 'working').length; stats.textContent = ''; stats.append(h('span', {}, h('b', {}, String(list.length)), ' crew'), h('span', {}, h('b', { class: working ? 'hot' : '' }, String(working)), ' working'), h('span', {}, h('b', {}, String(state.total)), ' files')); }
  function select(id) { state.sel = id; paintSide(); }
  let sideVersion = 0;
  const jobDrafts = new Map();
  async function paintSide() {
    const version = ++sideVersion;
    if (!state.sel) return paintCrewList();
    const id = state.sel, o = state.agents.get(id), isC = id === COMMANDER; let r = null; try { r = await bridge.agents.inspect(isC ? COMMANDER : id); } catch { /* the list below still works */ }
    if (state.sel !== id || version !== sideVersion) return; if (!r && !o && !isC) { state.sel = null; return paintCrewList(); }
    const name = isC ? state.aiName : (o && o.name) || (r && r.agent.name), role = isC ? 'Chief of staff' : (o && o.role) || (r && r.agent.role) || '', color = isC ? '#FFB23E' : (o && o.color) || '#6fe3e0', working = isC ? state.cmd.mode !== 'idle' : o && o.state === 'working';
    const now1 = isC ? (state.cmd.until > now() ? state.cmd.bubble : state.cmd.mode === 'idle' ? 'Standing by' : state.cmd.mode) : working ? (o.label || o.task || 'Working\u2026') : 'Resting';
    const files = (state.files.get(id) || []).slice(0, 6), jobs = (r && r.jobs) || [];
    const sec = (title, ...kids) => h('section', { class: 'of-sec' }, h('h4', {}, title), ...kids);
    // Per-worker engine/model override (blank fields inherit the crew default from Settings).
    const engineRow = isC ? null : (() => {
      const eng = h('select', {}, [['', 'Crew default'], ['builtin', 'Built-in'], ['hermes', 'Hermes Agent'], ['opencode', 'OpenCode']].map(([v, t]) => h('option', { value: v, selected: v === ((r && r.agent && r.agent.engine) || '') }, t)));
      const prov = h('input', { value: (r && r.agent && r.agent.workerProvider) || '', placeholder: 'gemini / openrouter / anthropic / openai / custom' });
      const model = h('input', { value: (r && r.agent && r.agent.workerModel) || '', placeholder: 'blank = crew model' });
      const key = h('input', { type: 'password', autocomplete: 'off', value: (r && r.agent && r.agent.workerApiKey) || '', placeholder: 'blank = crew key' });
      const base = h('input', { value: (r && r.agent && r.agent.workerBaseUrl) || '', placeholder: 'https://.../v1 (custom only)' });
      const out = h('small', {});
      return sec(`${name}'s own engine (blank = crew default)`,
        h('div', { class: 'set-grid' },
          h('label', { class: 'field' }, h('span', {}, 'Engine'), eng),
          h('label', { class: 'field' }, h('span', {}, 'Provider'), prov),
          h('label', { class: 'field' }, h('span', {}, 'Model'), model),
          h('label', { class: 'field' }, h('span', {}, 'API key'), key),
          h('label', { class: 'field' }, h('span', {}, 'Base URL'), base)),
        h('div', {}, h('button', { class: 'mini', type: 'button', onclick: async () => {
          out.textContent = 'Saving…';
          try { await bridge.agents.update(id, { engine: eng.value, workerProvider: prov.value.trim(), workerModel: model.value.trim(), workerApiKey: key.value.trim(), workerBaseUrl: base.value.trim() }); out.textContent = 'Saved.'; }
          catch (e) { out.textContent = String((e && e.message) || e); }
        } }, 'Save engine'), out));
    })();
    let usageRow = null;
    if (!isC) {
      try {
        const u = await bridge.usage.get();
        const ua = (u && u.byAgent || []).find(a => a.agentId === id);
        if (ua) usageRow = sec(`${name}'s usage today (Hermes crew runs)`,
          h('p', { class: 'of-dim' }, `${ua.req} request${ua.req === 1 ? '' : 's'}, ${ua.runs} run${ua.runs === 1 ? '' : 's'} \u00B7 ${(ua.inTok + ua.outTok).toLocaleString()} tokens \u00B7 ~$${ua.cost.toFixed(3)}`));
      } catch { /* usage is a convenience, never block the panel for it */ }
    }
    if (state.sel !== id || version !== sideVersion) return;
    side.replaceChildren(...[
      h('div', { class: 'of-head' }, h('div', { class: 'of-avatar', style: `border-color:${color};color:${color}` }, name[0].toUpperCase()), h('div', { class: 'of-who' }, h('b', {}, name), h('span', {}, role)), h('button', { class: 'of-x', type: 'button', 'aria-label': 'Close', onclick: () => select(null) }, '\u00D7')),
      h('div', { class: 'of-now ' + (working ? 'on' : '') }, dot(working ? 'run' : 'idle'), h('span', {}, now1)),
      h('div', { class: 'of-actions' },
        isC ? h('button', { class: 'mini danger', type: 'button', onclick: async () => { await bridge.stop.all(); paintSide(); } }, 'Stop everything')
            : h('button', { class: 'mini danger', type: 'button', disabled: !working && !jobs.some(j => j.status === 'queued' || j.status === 'running'), onclick: async () => { await bridge.stop.agent(id); setTimeout(paintSide, 400); } }, 'Stop this job'),
        h('button', { class: 'mini', type: 'button', onclick: () => window.__ws && __ws.focus(isC ? '' : id) }, 'Workspace'), r && r.folder ? h('button', { class: 'mini', type: 'button', onclick: () => bridge.showInFolder(r.folder) }, 'Folder') : null),
      isC ? null : sec('Jobs', r && r.jobsError ? h('p', { role: 'alert' }, r.jobsError) : null, jobs.length ? jobs.slice(0, 20).map(jobCard) : h('p', { class: 'of-dim' }, 'No jobs yet.')),
      sec(`Files (${(state.files.get(id) || []).length})`, files.length ? files.map(f => h('button', { class: 'of-file', type: 'button', title: f.rel, onclick: () => window.__ws && __ws.open(f.rel) }, h('span', {}, f.name), h('em', {}, f.size < 1024 ? f.size + ' B' : (f.size / 1024).toFixed(f.size < 10240 ? 1 : 0) + ' KB'))) : h('p', { class: 'of-dim' }, isC ? 'Files saved straight into the workspace.' : 'Nothing saved yet.')),
      r && r.skills && r.skills.length ? sec('Skills', h('div', { class: 'of-chips' }, ...r.skills.slice(0, 12).map(s => h('span', {}, s)))) : null,
      r && r.soul ? sec('Character', h('p', { class: 'of-dim' }, clip(r.soul.replace(/^#.*\n+/, '').split('\n').filter(Boolean).slice(0, 4).join(' '), 260))) : null].filter(Boolean));
    if (engineRow) side.appendChild(engineRow);
    if (!isC && bridge.jobs) {
      const task = h('textarea', { 'aria-label': 'New job task', placeholder: 'Describe the job' });
      const expected = h('textarea', { 'aria-label': 'Expected output files', placeholder: 'Optional: workspace-relative output files, one per line' });
      const draft = jobDrafts.get(id); task.value = draft?.task || ''; expected.value = draft?.expected || '';
      const saveDraft = () => jobDrafts.set(id, { task: task.value, expected: expected.value });
      task.addEventListener('input', saveDraft); expected.addEventListener('input', saveDraft);
      const out = h('small', { role: 'status' });
      side.appendChild(sec('Give a job', task, expected, h('button', { class: 'mini', type: 'button', onclick: async e => {
        if (!task.value.trim()) { out.textContent = 'Describe the job first.'; return; }
        const button = e.currentTarget; button.disabled = true; out.textContent = 'Queueing…';
        try { const result = await bridge.jobs.dispatch(id, task.value.trim(), expected.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)); if (!result || !result.ok) throw new Error(result && result.error || 'Could not queue the job.'); jobDrafts.delete(id); await paintSide(); }
        catch (err) { out.textContent = err.message || String(err); button.disabled = false; }
      } }, 'Queue job'), out));
    }
    if (!isC) {
      const cb = h('input', { type: 'checkbox', style: 'width:auto;margin:0' }); cb.checked = !(r && r.agent && r.agent.allowCode === false);
      const codeOut = h('small', {});
      cb.addEventListener('change', async () => {
        codeOut.textContent = 'Saving\u2026';
        try { await bridge.agents.update(id, { allowCode: cb.checked ? '' : false }); codeOut.textContent = cb.checked ? 'Allowed. Applies on their next job.' : 'Switched off. Applies on their next job.'; }
        catch (e) { cb.checked = !cb.checked; codeOut.textContent = String((e && e.message) || e); }
      });
      side.appendChild(sec(`${name}: code execution`, h('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:8px' }, cb, h('span', {}, 'Allow running code (Hermes engine only)')), codeOut));
    }
    if (usageRow) side.appendChild(usageRow);
  }
  function paintCrewList() {
    const list = [...state.agents.values()];
    side.replaceChildren(h('div', { class: 'of-head' }, h('div', { class: 'of-who' }, h('b', {}, 'The crew'), h('span', {}, `${list.length} on the floor`))),
      h('button', { class: 'of-row', type: 'button', onclick: () => select(COMMANDER) }, h('div', { class: 'of-avatar sm', style: 'border-color:#FFB23E;color:#FFB23E' }, state.aiName[0].toUpperCase()), h('div', { class: 'of-who' }, h('b', {}, state.aiName), h('span', {}, 'Chief of staff \u00B7 ' + (state.cmd.mode === 'idle' ? 'standing by' : state.cmd.mode)))),
      ...list.map(o => h('button', { class: 'of-row', type: 'button', onclick: () => select(o.id) }, h('div', { class: 'of-avatar sm', style: `border-color:${o.color};color:${o.color}` }, (o.name || '?')[0].toUpperCase()), h('div', { class: 'of-who' }, h('b', {}, o.name), h('span', {}, o.state === 'working' ? clip(o.label || o.task || 'working', 40) : 'resting \u00B7 ' + (o.role || ''))), dot(o.state === 'working' ? 'run' : 'idle'))),
      h('button', { class: 'mini', type: 'button', onclick: () => { window.__ws && __ws.show('bridge'); const b = document.getElementById('add-crew'); if (b) b.click(); } }, 'Add crew'));
  }

  /* ---------- entering and leaving ---------- */
  function enter(from) {
    const box = from || (document.querySelector('.panel.crew') || document.body).getBoundingClientRect(), ox = box.left + box.width / 2, oy = box.top + box.height / 2;
    root.style.setProperty('--ox', ox + 'px'); root.style.setProperty('--oy', oy + 'px'); root.classList.add('pre'); state.visible = true; state.snap = true; state.last = 0; resize(); loadAgents(); loadFiles(); paintSide();
    requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.remove('pre'); resize(); })); requestAnimationFrame(loop);
  }
  function leave() { state.visible = false; }
  // the way in from the Orbit: a button and a double click on the crew deck
  const deckHead = document.querySelector('.panel.crew .ph'), deck = document.getElementById('town');
  if (deckHead) { const b = h('button', { class: 'mini', type: 'button', title: 'Walk into the office (Alt+2)', onclick: () => window.__ws && __ws.show('office', { from: deckHead.closest('.panel').getBoundingClientRect() }) }, 'Enter office'); deckHead.insertBefore(b, deckHead.querySelector('#add-crew')); }
  if (deck) deck.addEventListener('dblclick', () => window.__ws && __ws.show('office', { from: deck.getBoundingClientRect() }));

  window.__office = { enter, leave, select, state, snapshot: () => [...state.agents.values()].map(o => ({ id: o.id, x: +o.x.toFixed(1), y: +o.y.toFixed(1), room: O.roomAt(o.x, o.y), state: o.state, dest: o.dest || null, moving: !!o.moving })), note, loadAgents };
})();
