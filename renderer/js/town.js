/* Crew deck: a top-down plan of the ship where every agent lives, walks to a console and works. */
(function () {
  'use strict';
  const ROOMS = [
    { name: 'Flight deck', x: 6, y: 19, w: 24, h: 22 }, { name: 'Lab', x: 32, y: 5, w: 22, h: 22 }, { name: 'Engineering', x: 32, y: 33, w: 22, h: 22 },
    { name: 'Comms', x: 56, y: 5, w: 22, h: 22 }, { name: 'Lounge', x: 56, y: 33, w: 34, h: 22 }
  ];
  const STATIONS = [[38, 14], [48, 14], [38, 44], [48, 44], [62, 14], [72, 14]];
  const LOUNGE = [[62, 42], [70, 46], [78, 42], [84, 48], [66, 50], [74, 38], [86, 40]];
  const CMD = [17, 30];
  const HULL = [[1.5, 30], [8, 11], [16, 5], [92, 4], [98, 11], [98, 49], [92, 56], [16, 55], [8, 49]];

  class Town {
    constructor(canvas, { onSelect } = {}) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); this.agents = new Map(); this.cmd = { name: '', level: 0, state: 'idle' }; this.onSelect = onSelect; this.selected = null; this.t = 0; this.hover = null;
      this.resize(); new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      canvas.addEventListener('click', e => { const id = this.hit(e); this.selected = id; if (this.onSelect) this.onSelect(id); });
      canvas.addEventListener('mousemove', e => { this.hover = this.hit(e); canvas.style.cursor = this.hover ? 'pointer' : 'default'; });
      requestAnimationFrame(t => this.loop(t));
    }
    resize() {
      const p = this.c.parentElement, dpr = Math.min(devicePixelRatio || 1, 2), w = p.clientWidth, h = p.clientHeight;
      this.c.width = Math.max(10, w * dpr); this.c.height = Math.max(10, h * dpr); this.c.style.width = w + 'px'; this.c.style.height = h + 'px'; this.dpr = dpr; this.w = w; this.h = h;
      this.k = Math.min(w / 100, h / 60); this.ox = (w - 100 * this.k) / 2; this.oy = (h - 60 * this.k) / 2;
    }
    P(x, y) { return [this.ox + x * this.k, this.oy + y * this.k]; }
    setAgents(list) {
      const seen = new Set();
      for (const a of list) {
        seen.add(a.id); let o = this.agents.get(a.id);
        if (!o) { const s = LOUNGE[a.station % LOUNGE.length]; o = { id: a.id, x: s[0], y: s[1], tx: s[0], ty: s[1], next: this.t + 2 + Math.random() * 4, state: 'idle', task: '' }; this.agents.set(a.id, o); }
        Object.assign(o, { name: a.name, color: a.color, station: a.station, role: a.role });
        if (a.state) { o.state = a.state; o.task = a.task || ''; }
      }
      for (const id of [...this.agents.keys()]) if (!seen.has(id)) this.agents.delete(id);
    }
    setState(id, st) { const o = this.agents.get(id); if (o) { o.state = st.state; o.task = st.task || ''; } }
    setCommander(p) { Object.assign(this.cmd, p); }
    hit(e) {
      const r = this.c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const test = (x, y, rad) => { const [px, py] = this.P(x, y); return Math.hypot(mx - px, my - py) < rad * this.k; };
      for (const o of this.agents.values()) if (test(o.x, o.y, 3.4)) return o.id;
      return test(CMD[0], CMD[1], 4) ? 'jarvis' : null;
    }
    loop(now) {
      requestAnimationFrame(t => this.loop(t)); if (document.hidden || !this.w) return;
      const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now; this.t += dt;
      for (const o of this.agents.values()) {
        if (o.state === 'working') { const s = STATIONS[o.station % STATIONS.length]; o.tx = s[0]; o.ty = s[1] + (s[1] < 30 ? 4.6 : -4.6); }
        else if (this.t > o.next) { const s = LOUNGE[(Math.random() * LOUNGE.length) | 0]; o.tx = s[0] + (Math.random() - .5) * 3; o.ty = s[1] + (Math.random() - .5) * 3; o.next = this.t + 5 + Math.random() * 9; }
        const dx = o.tx - o.x, dy = o.ty - o.y, d = Math.hypot(dx, dy); o.moving = d > 0.3;
        if (o.moving) { const v = Math.min(d, 16 * dt); o.x += dx / d * v; o.y += dy / d * v; }
      }
      this.draw();
    }
    draw() {
      const ctx = this.ctx, k = this.k; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.w, this.h);
      // hull
      ctx.beginPath(); HULL.forEach(([x, y], i) => { const [px, py] = this.P(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath();
      ctx.fillStyle = '#0B121C'; ctx.fill(); ctx.strokeStyle = 'rgba(220,216,204,0.35)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
      // corridor
      let [a, b] = this.P(30, 27), [c2, d2] = this.P(92, 33); ctx.fillStyle = '#0F1824'; ctx.fillRect(a, b, c2 - a, d2 - b);
      ctx.strokeStyle = 'rgba(255,178,62,0.25)'; ctx.setLineDash([k * 1.4, k * 1.4]); ctx.beginPath(); ctx.moveTo(a, (b + d2) / 2); ctx.lineTo(c2, (b + d2) / 2); ctx.stroke(); ctx.setLineDash([]);
      // rooms
      ctx.font = `${Math.max(9, k * 1.9)}px "Cascadia Mono",Consolas,monospace`; ctx.textBaseline = 'top';
      for (const r of ROOMS) {
        const [x, y] = this.P(r.x, r.y); ctx.fillStyle = '#0E1622'; ctx.fillRect(x, y, r.w * k, r.h * k);
        ctx.strokeStyle = 'rgba(111,227,224,0.28)'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, r.w * k, r.h * k);
        ctx.fillStyle = 'rgba(137,148,166,0.85)'; ctx.fillText(r.name, x + k * 1, y + k * 0.8);
      }
      // consoles
      const busy = new Set([...this.agents.values()].filter(o => o.state === 'working' && !o.moving).map(o => o.station % STATIONS.length));
      STATIONS.forEach(([sx, sy], i) => {
        const [x, y] = this.P(sx, sy), w = 7 * k, h = 2.6 * k; ctx.fillStyle = '#152233'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
        ctx.fillStyle = busy.has(i) ? `rgba(255,178,62,${0.6 + 0.3 * Math.sin(this.t * 7 + i)})` : 'rgba(111,227,224,0.22)'; ctx.fillRect(x - w / 2 + 3, y - h / 2 + 3, w - 6, h - 6);
      });
      // commander chair + halo
      const [cx, cy] = this.P(CMD[0], CMD[1]), lv = this.cmd.level, sp = this.cmd.state === 'speaking' || this.cmd.state === 'working' || this.cmd.state === 'thinking';
      ctx.fillStyle = '#152233'; ctx.fillRect(cx - 5 * k, cy - 8 * k, 2 * k, 16 * k);
      const halo = 4.2 * k + (sp ? (0.6 + lv * 2.4) * k : 0.5 * k * Math.sin(this.t * 1.5));
      ctx.strokeStyle = sp ? 'rgba(255,178,62,0.55)' : 'rgba(111,227,224,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, halo, 0, Math.PI * 2); ctx.stroke();
      this.person(cx, cy, 3 * k, '#FFB23E', (this.cmd.name || '?')[0], this.cmd.name, this.selected === 'jarvis', false);
      // crew
      for (const o of this.agents.values()) {
        const [x, y] = this.P(o.x, o.y), bob = o.moving ? Math.sin(this.t * 14) * k * 0.25 : 0;
        if (o.state === 'working' && !o.moving) { ctx.strokeStyle = o.color; ctx.globalAlpha = 0.5 + 0.4 * Math.sin(this.t * 4); ctx.beginPath(); ctx.arc(x, y + bob, 3.6 * k + Math.sin(this.t * 4) * k * 0.4, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
        this.person(x, y + bob, 2.3 * k, o.color, (o.name || '?')[0], o.name, this.selected === o.id || this.hover === o.id, o.state === 'working');
      }
      if (!this.agents.size) { ctx.fillStyle = 'rgba(137,148,166,0.9)'; ctx.font = `${Math.max(11, k * 2.3)}px "Bahnschrift","Segoe UI",sans-serif`; ctx.textAlign = 'center'; const [x, y] = this.P(72, 40); ctx.fillText('No crew yet', x, y - k * 1.5); ctx.font = `${Math.max(10, k * 1.8)}px "Bahnschrift","Segoe UI",sans-serif`; ctx.fillText('Ask for a new agent, or add one', x, y + k * 2.2); ctx.textAlign = 'left'; }
    }
    person(x, y, r, color, letter, name, hi, working) {
      const ctx = this.ctx; ctx.fillStyle = '#060A10'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = hi ? 3 : 2; ctx.stroke();
      ctx.fillStyle = color; ctx.font = `600 ${r * 1.1}px "Bahnschrift","Segoe UI",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(letter).toUpperCase(), x, y + 1);
      ctx.font = `${Math.max(9, r * 0.72)}px "Bahnschrift","Segoe UI",sans-serif`; ctx.fillStyle = hi ? '#fff' : 'rgba(220,216,204,0.9)'; ctx.textBaseline = 'top'; ctx.fillText(name || '', x, y + r + 3);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    }
  }
  window.Town = Town;
})();
