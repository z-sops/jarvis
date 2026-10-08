/* The AI's presence in the forward window: a ring that listens, thinks and speaks. */
(function () {
  'use strict';
  const COL = { offline: '128,146,168', connecting: '255,178,62', idle: '111,227,224', listening: '111,227,224', thinking: '255,178,62', working: '255,178,62', speaking: '255,178,62' };
  class Presence {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); this.state = 'offline'; this.level = 0; this.target = 0; this.t = 0;
      const dpr = Math.min(devicePixelRatio || 1, 2), S = 360; canvas.width = S * dpr; canvas.height = S * dpr; canvas.style.width = S + 'px'; canvas.style.height = S + 'px'; this.ctx.scale(dpr, dpr); this.S = S;
      this.low = matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(t => this.loop(t));
    }
    setState(s) { this.state = s; }
    setLevel(v) { this.target = Math.max(0, Math.min(1, v)); }
    loop(now) {
      requestAnimationFrame(t => this.loop(t)); if (document.hidden) return;
      const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now; this.t += dt;
      this.level += (this.target - this.level) * Math.min(1, dt * 12);
      const ctx = this.ctx, S = this.S, cx = S / 2, cy = S / 2, st = this.state, col = COL[st] || COL.idle, t = this.t;
      const busy = st === 'thinking' || st === 'working' || st === 'connecting';
      const amp = st === 'offline' ? 0.03 : busy ? 0.16 + 0.05 * Math.sin(t * 3) : st === 'idle' ? 0.06 : 0.1 + this.level * 0.9;
      ctx.clearRect(0, 0, S, S);
      let g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 170); g.addColorStop(0, `rgba(${col},${0.20 + amp * 0.4})`); g.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
      // core
      const r0 = 30 + amp * 26; g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, `rgba(${col},0.9)`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r0, 0, Math.PI * 2); ctx.fill();
      // voice ring
      ctx.strokeStyle = `rgba(${col},0.85)`; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 180; i++) {
        const a = i / 180 * Math.PI * 2, w = Math.sin(a * 7 + t * (busy ? 1.2 : 3)) * Math.sin(a * 3 - t * 1.7);
        const rr = 78 + w * (this.low ? 2 : 3 + amp * 30);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
      // outer rings
      ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${col},0.28)`; ctx.beginPath(); ctx.arc(cx, cy, 108, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([2, 9]); ctx.strokeStyle = `rgba(${col},0.4)`; ctx.beginPath(); ctx.arc(cx, cy, 132, t * 0.15, t * 0.15 + Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      if (busy) { ctx.lineWidth = 3; ctx.strokeStyle = `rgba(${col},0.9)`; for (let k = 0; k < 3; k++) { const a0 = t * 2.4 + k * 2.09; ctx.beginPath(); ctx.arc(cx, cy, 108, a0, a0 + 0.7); ctx.stroke(); } }
    }
  }
  window.Presence = Presence;
})();
