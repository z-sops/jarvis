/* Sci-fi effects layer: hull details, forward-window HUD, radar sweep on the crew deck.
   Purely visual. It reads the app's state from the DOM and never touches app logic.
   Ctrl+Shift+F switches all effects off and on (remembered). */
(function () {
  'use strict';
  const KEY = 'bridge.fx', CY = '111,227,224', AM = '255,178,62', TAU = Math.PI * 2;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = s => document.querySelector(s);
  let enabled = true; try { enabled = localStorage.getItem(KEY) !== 'off'; } catch {}
  const setEnabled = v => { enabled = v; document.body.classList.toggle('fx-off', !v); try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch {} };
  setEnabled(enabled);
  addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') setEnabled(!enabled); });

  const win = $('#window'), deck = $('.deck'), top = $('#topbar');
  if (!win || !top) return;
  const mk = (id, cls) => { const c = document.createElement('canvas'); if (id) c.id = id; if (cls) c.className = cls; c.setAttribute('aria-hidden', 'true'); return c; };
  const fit = (c, w, h) => { const d = Math.min(devicePixelRatio || 1, 1.5); c.width = Math.max(1, Math.round(w * d)); c.height = Math.max(1, Math.round(h * d)); const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); return x; };
  const rgba = (c, a) => `rgba(${c},${a})`;

  // ---------------------------------------------------------------- hull
  const hull = mk('hull-fx'), stat = document.createElement('canvas'); document.body.insertBefore(hull, top);
  const WIN = [[13, 9], [87, 9], [97, 51], [3, 51]];
  let HW = 0, HH = 0, hctx = null, hasPlates = true;

  function hazard(x, X, Y, w, h) {
    x.save(); x.beginPath(); x.rect(X, Y, w, h); x.clip(); x.fillStyle = 'rgba(8,10,14,.9)'; x.fillRect(X, Y, w, h); x.fillStyle = rgba(AM, .5);
    for (let i = -h; i < w + h; i += 14) { x.beginPath(); x.moveTo(X + i, Y + h); x.lineTo(X + i + 7, Y + h); x.lineTo(X + i + 7 + h, Y); x.lineTo(X + i + h, Y); x.closePath(); x.fill(); }
    x.restore(); x.strokeStyle = 'rgba(255,255,255,.12)'; x.strokeRect(X + .5, Y + .5, w - 1, h - 1);
  }
  function rivet(x, px, py) { x.fillStyle = 'rgba(0,0,0,.6)'; x.beginPath(); x.arc(px, py + .8, 2.2, 0, TAU); x.fill(); x.fillStyle = 'rgba(220,216,204,.16)'; x.beginPath(); x.arc(px, py, 1.7, 0, TAU); x.fill(); x.fillStyle = 'rgba(255,255,255,.28)'; x.beginPath(); x.arc(px - .5, py - .5, .6, 0, TAU); x.fill(); }
  function plate(x, cx, y, w, text) {
    x.fillStyle = 'rgba(0,0,0,.32)'; x.strokeStyle = 'rgba(220,216,204,.2)'; x.lineWidth = 1; x.beginPath(); x.roundRect(cx - w / 2, y, w, 19, 3); x.fill(); x.stroke();
    x.fillStyle = 'rgba(220,216,204,.6)'; x.font = '500 10.5px "Plex Mono", Consolas, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; try { x.letterSpacing = '2.5px'; } catch {} x.fillText(text, cx, y + 10); try { x.letterSpacing = '0px'; } catch {} x.textAlign = 'left';
  }
  function paintHullStatic() {
    const W = HW, H = HH, x = fit(stat, W, H), P = (a, b) => [a / 100 * W, b / 100 * H], topY = P(0, 9)[1];
    x.save(); x.beginPath(); x.rect(0, 0, W, H); WIN.forEach(([a, b], i) => { const [px, py] = P(a, b); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); x.clip('evenodd');
    x.strokeStyle = 'rgba(255,255,255,.055)'; x.lineWidth = 1;
    for (let i = 1; i < 14; i++) { const px = Math.round(W * i / 14) + .5; x.beginPath(); x.moveTo(px, 44); x.lineTo(px, topY); x.stroke(); }
    x.beginPath(); x.moveTo(0, 44.5); x.lineTo(W, 44.5); x.stroke();
    for (let px = 28; px < W; px += 56) { rivet(x, px, 51); rivet(x, px, topY - 9); }
    hazard(x, 22, 54, 92, 8); hazard(x, W - 114, 54, 92, 8);
    const py = Math.max(47, topY - 28); hasPlates = py + 18 < topY - 1;
    if (hasPlates) { plate(x, W / 2, py, 210, 'BRIDGE  \u00b7  DECK 01'); plate(x, W * 0.27, py, 128, 'FWD VIEW 01'); plate(x, W * 0.73, py, 128, 'SECTOR 07'); }
    for (let k = 1; k <= 3; k++) { const o = k * 2.6; let a = P(13 - o, 9), b = P(3 - o, 51); x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); a = P(87 + o, 9); b = P(97 + o, 51); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); }
    for (let r = 0; r < 6; r++) { const y = P(0, 21 + r * 2.5)[1]; x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(W * .012, y, W * .034, 3.5); x.fillRect(W * .954, y, W * .034, 3.5); x.fillStyle = rgba(CY, .09); x.fillRect(W * .012, y + 3.5, W * .034, 1); x.fillRect(W * .954, y + 3.5, W * .034, 1); }
    const sy = P(0, 51)[1], ey = P(0, 52.4)[1]; x.fillStyle = 'rgba(2,5,10,.75)'; x.fillRect(0, sy, W, ey - sy); x.fillStyle = 'rgba(255,255,255,.07)'; x.fillRect(0, sy, W, 1);
    x.restore();
  }
  function drawHull(t) {
    const W = HW, H = HH, x = hctx; x.clearRect(0, 0, W, H); x.drawImage(stat, 0, 0, W, H);
    const pts = WIN.map(([a, b]) => [a / 100 * W, b / 100 * H]);
    let per = 0; for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const path = () => { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); };
    x.save(); x.lineJoin = 'round';
    path(); x.strokeStyle = rgba(CY, .26 + .1 * Math.sin(t * 1.2)); x.lineWidth = 2; x.shadowColor = rgba(CY, .9); x.shadowBlur = 16; x.stroke();
    path(); x.setLineDash([150, per]); x.lineDashOffset = -((t * 0.09) % 1) * per; x.strokeStyle = rgba(AM, .9); x.lineWidth = 3; x.shadowColor = rgba(AM, 1); x.shadowBlur = 20; x.stroke();
    x.restore();
    // status lights on the sill and above the window
    const y = .517 * H, n = Math.floor(W / 28);
    for (let i = 0; i < n; i++) { const c = Math.max(0, Math.sin(t * 2.4 - i * .3)), mid = Math.abs(i / n - .5) < .14, col = mid ? CY : AM; x.fillStyle = rgba(col, .16 + .74 * c); x.shadowColor = rgba(col, .9); x.shadowBlur = c > .5 ? 8 : 0; x.fillRect(12 + i * 28, y, 18, 3.2); }
    x.shadowBlur = 0; const ty = .09 * H - 6;
    if (hasPlates) [[.27, '123,216,143', 2.7], [.5, CY, 1.9], [.73, AM, 1.3]].forEach(([fx, c, sp], k) => { const a = .35 + .65 * (Math.sin(t * sp + k) > 0 ? 1 : .15); x.fillStyle = rgba(c, a); x.shadowColor = rgba(c, 1); x.shadowBlur = 7; x.beginPath(); x.arc(W * fx, ty, 2.6, 0, TAU); x.fill(); });
    x.shadowBlur = 0;
  }

  // ---------------------------------------------------------------- forward window HUD
  const hud = mk('hud'), glass = document.createElement('div'); glass.className = 'glass'; win.insertBefore(hud, win.firstChild); win.insertBefore(glass, hud.nextSibling);
  let hw = 0, hh = 0, hx = null, spin = 0;
  const micLevel = () => { if (window.__mic && typeof window.__mic.level === 'number') return window.__mic.level; const m = $('#micmeter'), r = m && /scaleY\(([\d.]+)\)/.exec(m.style.transform || ''); return r ? +r[1] : 0; };
  const crewCount = () => { try { return window.__ui.town.agents.size; } catch { return 0; } };
  function state() { const s = (($('#hud-status') || {}).textContent || '').trim(); return { s, active: /speaking|working|thinking|connecting/i.test(s), listening: /listening/i.test(s), muted: /muted/i.test(s) }; }

  function drawHud(t, dt) {
    const w = hw, h = hh, x = hx, st = state(), col = st.active ? AM : (window.__mic && window.__mic.hearing ? '120,255,160' : CY); x.clearRect(0, 0, w, h);
    spin += dt * (reduce ? 0 : st.active ? .55 : st.listening ? .16 : .06);
    // compass strip
    const y0 = h * .05, ppd = 3.4, hd = reduce ? 274 : (274 + t * 2.4) % 360;
    x.strokeStyle = rgba(CY, .35); x.lineWidth = 1; x.beginPath(); x.moveTo(w * .26, y0); x.lineTo(w * .74, y0); x.stroke();
    x.font = '500 9.5px "Plex Mono", Consolas, monospace'; x.textAlign = 'center'; x.textBaseline = 'top';
    for (let d = Math.floor((hd - 66) / 5) * 5; d <= hd + 66; d += 5) {
      const px = w / 2 + (d - hd) * ppd, f = 1 - Math.min(1, Math.abs(px - w / 2) / (w * .24)); if (f <= 0) continue;
      const big = ((d % 15) + 15) % 15 === 0; x.strokeStyle = rgba(CY, (big ? .8 : .4) * f); x.beginPath(); x.moveTo(px, y0); x.lineTo(px, y0 + (big ? 10 : 5)); x.stroke();
      if (((d % 30) + 30) % 30 === 0) { x.fillStyle = rgba(CY, .8 * f); x.fillText(String(((d % 360) + 360) % 360).padStart(3, '0'), px, y0 + 13); }
    }
    x.fillStyle = rgba(AM, .95); x.beginPath(); x.moveTo(w / 2, y0 - 1); x.lineTo(w / 2 - 4, y0 - 8); x.lineTo(w / 2 + 4, y0 - 8); x.closePath(); x.fill();
    // corner brackets
    x.strokeStyle = rgba(AM, .6); x.lineWidth = 1.5; const br = (px, py, dx, dy) => { x.beginPath(); x.moveTo(px + dx * 24, py); x.lineTo(px, py); x.lineTo(px, py + dy * 24); x.stroke(); };
    br(w * .13 + 14, 10, 1, 1); br(w * .87 - 14, 10, -1, 1); br(w * .03 + 14, h - 10, 1, -1); br(w * .97 - 14, h - 10, -1, -1);
    // voice ring around the AI
    const cx = w / 2, cy = h / 2, R = Math.min(h * .4, 150);
    if (R > 90) {
      const N = 120; for (let i = 0; i < N; i++) { const a = spin + i * TAU / N, L = i % 10 === 0 ? 10 : i % 5 === 0 ? 6.5 : 3.5; x.strokeStyle = rgba(col, i % 10 === 0 ? .8 : .38); x.lineWidth = i % 10 === 0 ? 1.6 : 1; x.beginPath(); x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.lineTo(cx + Math.cos(a) * (R - L), cy + Math.sin(a) * (R - L)); x.stroke(); }
      x.lineWidth = 2; x.strokeStyle = rgba(col, .65); x.shadowColor = rgba(col, .9); x.shadowBlur = 10; x.beginPath(); x.arc(cx, cy, R - 18, -spin * 1.7, -spin * 1.7 + 1.15); x.stroke(); x.beginPath(); x.arc(cx, cy, R - 18, -spin * 1.7 + 3.1, -spin * 1.7 + 3.1 + .5); x.stroke();
      x.strokeStyle = rgba(st.active ? CY : AM, .4); x.beginPath(); x.arc(cx, cy, R + 9, spin * 1.2, spin * 1.2 + .8); x.stroke(); x.shadowBlur = 0;
      x.fillStyle = rgba(col, .8); x.font = '500 9px "Plex Mono", Consolas, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('VOICE', cx, cy - R + 22); x.fillText('NET', cx, cy + R - 22); x.textAlign = 'left'; x.fillText('MEM', cx + R - 34, cy); x.textAlign = 'right'; x.fillText('CORE', cx - R + 34, cy);
    }
    // orbit path with a moving marker
    const ocx = w / 2, ocy = h * 1.45, orx = w * .55, ory = h * .95; x.setLineDash([5, 7]); x.strokeStyle = rgba(CY, .3); x.lineWidth = 1; x.beginPath(); x.ellipse(ocx, ocy, orx, ory, 0, Math.PI * 1.08, Math.PI * 1.92); x.stroke(); x.setLineDash([]);
    const oa = Math.PI * 1.08 + (((reduce ? 0 : t * .012) % 1) * (Math.PI * .84)), mx = ocx + Math.cos(oa) * orx, my = ocy + Math.sin(oa) * ory;
    x.fillStyle = rgba(AM, 1); x.shadowColor = rgba(AM, 1); x.shadowBlur = 10; x.beginPath(); x.arc(mx, my, 3, 0, TAU); x.fill(); x.shadowBlur = 0; x.strokeStyle = rgba(AM, .5); x.beginPath(); x.arc(mx, my, 7, 0, TAU); x.stroke();
    x.fillStyle = rgba(AM, .85); x.font = '500 9.5px "Plex Mono", Consolas, monospace'; x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillText('ORBIT 07', Math.min(mx + 12, w * .9), Math.min(my - 6, h - 24));
    // telemetry columns
    const row = (px, py, k, v, right) => { x.textAlign = right ? 'right' : 'left'; x.fillStyle = rgba(CY, .6); x.fillText(k, px, py); x.fillStyle = 'rgba(220,216,204,.92)'; x.fillText(v, right ? px - 46 : px + 40, py); };
    x.font = '500 10.5px "Plex Mono", Consolas, monospace'; x.textBaseline = 'alphabetic';
    const lx = w * .105, ly = h * .5; x.strokeStyle = rgba(CY, .35); x.lineWidth = 1; x.beginPath(); x.moveTo(lx - 10, ly - 12); x.lineTo(lx - 10, ly + 56); x.stroke();
    row(lx, ly, 'ALT', (408.2 + Math.sin(t / 40) * 1.6).toFixed(1) + ' km'); row(lx, ly + 17, 'VEL', (7.66 + Math.sin(t / 55) * .01).toFixed(2) + ' km/s'); row(lx, ly + 34, 'INC', '51.64 deg'); row(lx, ly + 51, 'ORB', (92.68 + Math.sin(t / 90) * .05).toFixed(2) + ' min');
    const rx = w * .895, lvl = st.muted ? 0 : micLevel(), on = Math.round(lvl * 8), lab = rx - 104;
    x.strokeStyle = rgba(CY, .35); x.beginPath(); x.moveTo(rx + 10, ly - 12); x.lineTo(rx + 10, ly + 56); x.stroke();
    const rrow = (py, k, v) => { x.textAlign = 'left'; x.fillStyle = rgba(CY, .6); x.fillText(k, lab, py); x.textAlign = 'right'; x.fillStyle = 'rgba(220,216,204,.92)'; x.fillText(v, rx, py); };
    rrow(ly, 'LINK', (st.s || 'OFFLINE').toUpperCase().slice(0, 11));
    x.textAlign = 'left'; x.fillStyle = rgba(CY, .6); x.fillText('MIC', lab, ly + 17); for (let m = 0; m < 8; m++) { x.fillStyle = m < on ? rgba(AM, .95) : rgba(CY, .2); x.fillRect(rx - 62 + m * 8, ly + 9, 6, 8); }
    rrow(ly + 34, 'CREW', String(crewCount()).padStart(2, '0')); rrow(ly + 51, 'MET', ((($('#met') || {}).textContent) || 'T+ 00:00:00').replace('T+ ', ''));
    x.textAlign = 'left';
  }

  // ---------------------------------------------------------------- crew deck radar
  const dk = mk(null, 'deck-fx'); if (deck) deck.appendChild(dk);
  let dw = 0, dh = 0, dx = null;
  function drawDeck(t) {
    const w = dw, h = dh, x = dx, cx = w / 2, cy = h / 2, m = Math.max(w, h), a = reduce ? 0 : (t * .9) % TAU; x.clearRect(0, 0, w, h);
    x.strokeStyle = rgba(CY, .09); x.lineWidth = 1; [.18, .34, .5].forEach(r => { x.beginPath(); x.arc(cx, cy, m * r, 0, TAU); x.stroke(); }); x.beginPath(); x.moveTo(0, cy); x.lineTo(w, cy); x.moveTo(cx, 0); x.lineTo(cx, h); x.stroke();
    if (!x.createConicGradient) return; const g = x.createConicGradient(a, cx, cy); g.addColorStop(0, rgba(CY, 0)); g.addColorStop(.91, rgba(CY, 0)); g.addColorStop(1, rgba(CY, .13)); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, m, 0, TAU); x.fill();
    x.strokeStyle = rgba(CY, .5); x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * m, cy + Math.sin(a) * m); x.stroke();
  }

  // ---------------------------------------------------------------- layout + loop
  function layout() {
    HW = innerWidth; HH = innerHeight; hctx = fit(hull, HW, HH); paintHullStatic();
    hw = win.clientWidth; hh = win.clientHeight; if (hw && hh) hx = fit(hud, hw, hh);
    if (deck) { dw = deck.clientWidth; dh = deck.clientHeight; if (dw && dh) dx = fit(dk, dw, dh); }
  }
  layout(); addEventListener('resize', layout);
  if (window.ResizeObserver) { const ro = new ResizeObserver(layout); ro.observe(win); if (deck) ro.observe(deck); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

  let last = 0, t = 0, aH = 0, aU = 0, aD = 0;
  (function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(.1, (now - (last || now)) / 1000); last = now;
    if (!enabled || document.hidden) return; t += dt; aH += dt; aU += dt; aD += dt;
    const slow = reduce ? .5 : 0;
    if (aH > (slow || .1)) { aH = 0; drawHull(t); }
    if (aU > (slow || 1 / 30) && hx) { drawHud(t, aU); aU = 0; }
    if (aD > (slow || 1 / 20) && dx) { aD = 0; drawDeck(t); }
  })(0);
})();
