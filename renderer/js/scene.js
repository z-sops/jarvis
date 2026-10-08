/* The world behind the UI: launch pad at night -> ascent -> low Earth orbit.
   Everything is drawn procedurally (no image assets): a spherical Earth built from 3D noise,
   city lights on the night side, an atmosphere limb and a sunrise flare. */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function noise3(seed) {
    const r = rng(seed), P = new Uint8Array(512), V = new Float32Array(256), perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
    for (let i = 0; i < 256; i++) V[i] = r();
    const f = t => t * t * (3 - 2 * t);
    return (x, y, z) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = f(x - xi), yf = f(y - yi), zf = f(z - zi);
      const X = xi & 255, Y = yi & 255, Z = zi & 255, h = (a, b, c) => V[P[P[P[X + a] + Y + b] + Z + c]];
      const x00 = lerp(h(0, 0, 0), h(1, 0, 0), xf), x10 = lerp(h(0, 1, 0), h(1, 1, 0), xf), x01 = lerp(h(0, 0, 1), h(1, 0, 1), xf), x11 = lerp(h(0, 1, 1), h(1, 1, 1), xf);
      return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
    };
  }
  const fbm = (n, x, y, z, o) => { let s = 0, a = 0.5, fr = 1, tot = 0; for (let i = 0; i < o; i++) { s += a * n(x * fr, y * fr, z * fr); tot += a; a *= 0.5; fr *= 2; } return s / tot; };

  const TW = 1536, TH = 768;
  const tex = { ready: false, rgb: null, lights: null, clouds: null };

  async function buildTexture() {
    const t0 = performance.now();
    const n1 = noise3(11), n2 = noise3(29), n3 = noise3(47), n4 = noise3(83);
    const px = new Uint8ClampedArray(TW * TH * 3), lights = new Uint8Array(TW * TH), clouds = new Uint8Array(TW * TH);
    for (let y0 = 0; y0 < TH; y0 += 24) {
      for (let y = y0; y < Math.min(TH, y0 + 24); y++) {
        const lat = (0.5 - (y + 0.5) / TH) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat), alat = Math.abs(lat);
        for (let x = 0; x < TW; x++) {
          const lon = (x / TW) * TAU - Math.PI, X = cl * Math.cos(lon), Y = sl, Z = cl * Math.sin(lon), i = y * TW + x;
          const e = fbm(n1, X * 1.7 + 3, Y * 1.7, Z * 1.7, 6), moist = fbm(n2, X * 2.2, Y * 2.2 + 5, Z * 2.2, 4);
          let r, g, b;
          if (e < 0.5) { const d = clamp((0.5 - e) / 0.22, 0, 1); [r, g, b] = mix3([40, 108, 168], [7, 28, 76], d); }
          else {
            const h = clamp((e - 0.5) / 0.25, 0, 1);
            const dry = clamp(1.15 - moist * 1.9 + Math.exp(-Math.pow(alat - 0.45, 2) / 0.03) * 0.45, 0, 1);
            [r, g, b] = mix3(mix3([44, 100, 56], [72, 120, 60], moist), [182, 152, 92], dry);
            [r, g, b] = mix3([r, g, b], [122, 108, 96], smooth(0.5, 0.95, h));
            const ice = smooth(1.05, 1.3, alat + h * 0.25); [r, g, b] = mix3([r, g, b], [236, 242, 248], ice);
            const c = fbm(n3, X * 9, Y * 9, Z * 9, 3);
            if (c > 0.6 && alat < 1.05 && ice < 0.2) lights[i] = clamp((c - 0.6) * 900, 0, 255);
          }
          px[i * 3] = r; px[i * 3 + 1] = g; px[i * 3 + 2] = b;
          clouds[i] = smooth(0.52, 0.74, fbm(n4, X * 2.3 + 7, Y * 3.2, Z * 2.3, 5)) * 235;
        }
      }
      await new Promise(r => setTimeout(r, 0));
    }
    tex.rgb = px; tex.lights = lights; tex.clouds = clouds; tex.ready = true; tex.readyAt = performance.now(); console.log('[scene] Earth texture built in ' + Math.round(tex.readyAt - t0) + ' ms');
  }

  class Scene {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.mode = 'pad'; this.t = 0; this.last = 0; this.launchT = -1; this.rot = 0; this.earthAlpha = 0; this.frame = 0;
      this.alt = 0; this.earthRise = 0; this.onLaunchEnd = null; this.lowMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const r = rng(5); this.stars = Array.from({ length: 520 }, () => ({ x: r(), y: r() * 0.9, z: r(), tw: r() * TAU }));
      this.smoke = [];
      this.buf = document.createElement('canvas'); this.bctx = this.buf.getContext('2d');
      this.resize(); addEventListener('resize', () => this.resize());
      buildTexture().then(() => { this.dirty = true; });
      requestAnimationFrame(t => this.loop(t));
    }
    resize() {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      this.W = innerWidth; this.H = innerHeight; this.c.width = this.W * dpr; this.c.height = this.H * dpr; this.dpr = dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.horizonY = this.H * 0.33; this.winBottom = this.H * 0.55;
      this.R = this.W * 0.8; this.cx = this.W / 2; this.buildSphere();
    }
    buildSphere() {
      // Precompute, per pixel of the low-res Earth buffer, where it lands on the sphere and how it is lit.
      const step = 2, top = Math.floor(this.horizonY - 30), bw = Math.ceil(this.W / step), bh = Math.ceil((this.winBottom - top + 6) / step);
      this.buf.width = bw; this.buf.height = bh; this.bw = bw; this.bh = bh; this.top = top; this.step = step;
      const N = bw * bh, R = this.R, cy = this.horizonY + R, a = 0.85, ca = Math.cos(a), sa = Math.sin(a), L = [0.86, 0.42, 0.28];
      this.inside = new Uint8Array(N); this.grain = new Float32Array(N); { const gr = rng(99); for (let i = 0; i < N; i++) this.grain[i] = (gr() * 2 - 1) * 0.06; } this.lonT = new Float32Array(N); this.rowT = new Uint32Array(N); this.dayShade = new Float32Array(N); this.rim = new Float32Array(N);
      for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
        const x = i * step + step / 2, y = top + j * step + step / 2, nx = (x - this.cx) / R, ny = -(y - cy) / R, r2 = nx * nx + ny * ny, k = j * bw + i;
        if (r2 >= 1) continue;
        const nz = Math.sqrt(1 - r2), py = ny * ca - nz * sa, pz = ny * sa + nz * ca, lat = Math.asin(clamp(py, -1, 1)), lon = Math.atan2(nx, pz);
        this.inside[k] = 1; this.lonT[k] = (lon + Math.PI) / TAU * TW;
        this.rowT[k] = clamp(Math.floor((0.5 - lat / Math.PI) * TH), 0, TH - 1) * TW;
        this.dayShade[k] = smooth(-0.08, 0.28, nx * L[0] + ny * L[1] + nz * L[2]);
        this.rim[k] = Math.pow(1 - nz, 3);
      }
      this.img = this.bctx.createImageData(bw, bh); this.px32 = new Uint32Array(this.img.data.buffer); this.dirty = true;
    }
    drawEarthBuffer() {
      if (!tex.ready) return;
      const { inside, lonT, rowT, dayShade, rim, grain, px32, bw, bh } = this, rgbT = tex.rgb, lt = tex.lights, cl = tex.clouds;
      const rot = (this.rot / TAU) * TW, rotC = rot * 1.12 + 40, tw = performance.now() / 1000;
      const flick = 0.85 + 0.15 * Math.sin(tw * 2);
      for (let k = 0, N = bw * bh; k < N; k++) {
        if (!inside[k]) { px32[k] = 0; continue; }
        const tx = ((lonT[k] + rot) % TW) | 0, ti = rowT[k] + tx, tc = rowT[k] + (((lonT[k] + rotC) % TW) | 0);
        const d = dayShade[k], n = 1 - d, ca = cl[tc] / 255 * 0.88, rm = rim[k];
        let r = rgbT[ti * 3], g = rgbT[ti * 3 + 1], b = rgbT[ti * 3 + 2];
        r += (238 - r) * ca; g += (242 - g) * ca; b += (248 - b) * ca;
        const lit = (0.06 + 0.96 * d) * (1 + grain[k]);
        r = r * lit; g = g * lit; b = b * lit;
        const L = lt[ti]; if (L && n > 0.3) { const w = (L / 255) * n * flick * (1 - ca * 0.8); r += 255 * w; g += 190 * w; b += 90 * w; }
        const hz = rm * (0.3 + 1.1 * d); r += 40 * hz; g += 105 * hz; b += 255 * hz * 0.9;
        px32[k] = (255 << 24) | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
      }
      this.bctx.putImageData(this.img, 0, 0);
    }
    startLaunch() { this.mode = 'launch'; this.launchT = 0; this.smoke = []; }
    skipToOrbit() { this.mode = 'orbit'; this.alt = 1; this.earthRise = 1; this.launchT = -1; }

    loop(now) {
      requestAnimationFrame(t => this.loop(t));
      if (document.hidden) return;
      if (document.body.dataset.look === 'holo' && document.body.classList.contains('phase-bridge')) return;   // the planet is not shown in the holographic look, so it is not drawn
      const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now; this.t += dt; this.frame++;
      this.rot += dt * (this.lowMotion ? 0.004 : 0.018);
      if (this.mode === 'launch') this.stepLaunch(dt);
      const ctx = this.ctx, W = this.W, H = this.H;
      ctx.save();
      if (this.mode === 'launch' && this.launchT < 7 && !this.lowMotion) { const s = (1 - this.launchT / 7) * 5 * (H / 900); ctx.translate((Math.random() - .5) * s, (Math.random() - .5) * s); }
      this.drawSky(ctx, W, H);
      if (this.mode !== 'orbit' || this.earthRise < 1) this.drawPad(ctx, W, H);
      if (this.earthRise > 0) this.drawEarth(ctx, W, H);
      ctx.restore();
    }
    stepLaunch(dt) {
      this.launchT += dt; const t = this.launchT;
      this.alt = smooth(0, 10.5, t); this.earthRise = smooth(9.2, 13.5, t);
      if (t > 14 && this.mode === 'launch') { this.mode = 'orbit'; this.alt = 1; this.earthRise = 1; if (this.onLaunchEnd) this.onLaunchEnd(); }
    }
    drawSky(ctx, W, H) {
      const a = this.alt, k0 = [[10, 14, 40], [40, 50, 110], [235, 140, 84]], k1 = [[5, 8, 26], [22, 42, 104], [94, 144, 214]], k2 = [[2, 3, 8], [2, 3, 9], [3, 5, 12]];
      const kk = a < 0.5 ? [0, 1, a / 0.5] : [1, 2, (a - 0.5) / 0.5], K = [k0, k1, k2], A = K[kk[0]], B = K[kk[1]], t = kk[2];
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, rgb(mix3(A[0], B[0], t))); g.addColorStop(0.55, rgb(mix3(A[1], B[1], t))); g.addColorStop(0.82, rgb(mix3(A[2], B[2], t))); g.addColorStop(1, rgb(mix3(A[2], B[2], t)));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const sa = smooth(0.2, 0.75, a); if (sa <= 0.01) return;
      const drift = this.lowMotion ? 0 : this.t * 0.004;
      for (const s of this.stars) {
        const x = ((s.x - drift * (0.2 + s.z)) % 1 + 1) % 1 * W, y = s.y * H, tw = 0.65 + 0.35 * Math.sin(this.t * (0.6 + s.z) + s.tw);
        ctx.fillStyle = `rgba(${200 + s.z * 55 | 0},${215 + s.z * 40 | 0},255,${sa * tw * (0.25 + s.z * 0.7)})`;
        const z = s.z > 0.93 ? 2 : 1; ctx.fillRect(x, y, z, z);
      }
    }
    drawEarth(ctx, W, H) {
      const rise = this.earthRise, yoff = (1 - smooth(0, 1, rise)) * (H * 0.75);
      if (tex.ready && (this.dirty || this.frame % 2 === 0)) { this.drawEarthBuffer(); this.dirty = false; }
      ctx.save(); ctx.translate(0, yoff);
      if (tex.ready) { ctx.globalAlpha = smooth(0, 1.4, (performance.now() - tex.readyAt) / 1000); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(this.buf, 0, this.top, this.bw * this.step, this.bh * this.step); ctx.globalAlpha = 1; }
      const R = this.R, cy = this.horizonY + R, cx = this.cx;
      ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createLinearGradient(0, 0, W, 0); lg.addColorStop(0, 'rgba(60,120,220,0.28)'); lg.addColorStop(0.6, 'rgba(110,190,255,0.6)'); lg.addColorStop(1, 'rgba(255,240,220,0.95)');
      ctx.strokeStyle = 'rgba(70,140,255,0.10)'; ctx.lineWidth = 26; ctx.beginPath(); ctx.arc(cx, cy, R + 12, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.strokeStyle = lg; ctx.lineWidth = 2.4; ctx.shadowColor = '#5aa6ff'; ctx.shadowBlur = 22; ctx.beginPath(); ctx.arc(cx, cy, R + 1, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); ctx.shadowBlur = 0;
      // sunrise flare where the sun grazes the limb
      const sx = W * 0.8, sy = cy - Math.sqrt(Math.max(0, R * R - (sx - cx) * (sx - cx))), p = 0.86 + 0.14 * Math.sin(this.t * 0.7) , rs = 120 * p;
      let g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rs); g.addColorStop(0, 'rgba(255,250,235,0.95)'); g.addColorStop(0.18, 'rgba(255,205,140,0.55)'); g.addColorStop(1, 'rgba(255,150,80,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - rs, sy - rs, rs * 2, rs * 2);
      ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.018); g = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.55);
      g.addColorStop(0, 'rgba(255,235,205,0.9)'); g.addColorStop(0.3, 'rgba(255,190,120,0.25)'); g.addColorStop(1, 'rgba(255,170,100,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, W * 0.55, 0, TAU); ctx.fill(); ctx.restore();
      for (const [f, r, a] of [[0.35, 26, 0.05], [0.62, 46, 0.035], [0.9, 16, 0.06]]) { const gx = lerp(sx, W * 0.5, f), gy = lerp(sy, H * 0.3, f); ctx.fillStyle = `rgba(120,200,255,${a * p})`; ctx.beginPath(); ctx.arc(gx, gy, r, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    drawPad(ctx, W, H) {
      const t = this.launchT, s = H / 900, launched = t >= 0;
      const lift = launched ? Math.pow(Math.max(0, t - 0.6), 2.1) * 16 * s : 0;
      const camY = launched ? Math.max(0, lift - 90 * s) : 0, stackY = lift - camY, exit = launched ? smooth(8.5, 11, t) : 0;
      const groundA = 1 - smooth(4, 9, launched ? t : 0); const horizon = H * 0.86 + camY;
      const fade = 1 - smooth(0.9, 1, this.earthRise);
      ctx.save(); ctx.globalAlpha = fade;
      if (groundA > 0.01 && horizon < H + 40) {
        ctx.fillStyle = '#05070b'; ctx.fillRect(0, horizon, W, H - horizon + 60);
        ctx.fillStyle = 'rgba(255,190,120,0.5)'; for (let i = 0; i < 40; i++) ctx.fillRect((i * 137.5) % W, horizon + 3 + (i % 3) * 2, 1.6, 1.6);
        // service tower
        const tx = W * 0.8 - 74 * s; ctx.strokeStyle = '#10151d'; ctx.lineWidth = 2 * s;
        ctx.strokeRect(tx, horizon - 420 * s, 26 * s, 420 * s);
        for (let y = 0; y < 420; y += 30) { ctx.beginPath(); ctx.moveTo(tx, horizon - y * s); ctx.lineTo(tx + 26 * s, horizon - (y + 30) * s); ctx.stroke(); }
        ctx.fillStyle = '#ff4a3a'; ctx.globalAlpha = fade * (0.5 + 0.5 * Math.sin(this.t * 3)); ctx.fillRect(tx + 10 * s, horizon - 424 * s, 5 * s, 5 * s); ctx.globalAlpha = fade;
        // floodlight beams
        ctx.globalCompositeOperation = 'lighter';
        for (const [bx, dir] of [[W * 0.5, 1], [W * 0.95, -1]]) { const g = ctx.createLinearGradient(bx, horizon, W * 0.8, horizon - 400 * s); g.addColorStop(0, 'rgba(255,240,210,0.16)'); g.addColorStop(1, 'rgba(255,240,210,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(bx, horizon); ctx.lineTo(W * 0.8 - 40 * s, horizon - 470 * s); ctx.lineTo(W * 0.8 + 40 * s, horizon - 470 * s); ctx.closePath(); ctx.fill(); }
        ctx.globalCompositeOperation = 'source-over';
      }
      if (exit < 1) this.drawStack(ctx, W * 0.8, horizon, s, launched ? t : -1, stackY, exit, H * 0.86);
      if (launched && groundA > 0.01) this.drawSmoke(ctx, W * 0.8, horizon, s, t, groundA);
      ctx.restore();
    }
    drawStack(ctx, x, horizon, s, t, stackY, exit, groundY) {
      // side view of orbiter + tank + boosters. Base sits at (x, base).
      const base = groundY - stackY - exit * (this.H * 1.4), h = 470 * s; if (base < -h) return;
      ctx.save();
      ctx.globalAlpha *= 1 - exit * 0.9;
      const tankW = 36 * s, tankH = h * 0.86, tx = x - tankW / 2;
      let g = ctx.createLinearGradient(tx, 0, tx + tankW, 0); g.addColorStop(0, '#7a3a17'); g.addColorStop(0.55, '#e0782e'); g.addColorStop(1, '#5a2a10');
      ctx.fillStyle = g; ctx.fillRect(tx, base - tankH, tankW, tankH);
      ctx.beginPath(); ctx.moveTo(tx, base - tankH); ctx.quadraticCurveTo(x, base - tankH - 72 * s, tx + tankW, base - tankH); ctx.fill();
      for (const side of [-1, 1]) {
        const bw = 19 * s, bx = x + side * (tankW / 2 + bw / 2 + 1 * s) - bw / 2, bh = h * 0.62;
        g = ctx.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#9aa0a8'); g.addColorStop(0.5, '#f2f4f6'); g.addColorStop(1, '#7a808a');
        ctx.fillStyle = g; ctx.fillRect(bx, base - bh, bw, bh);
        ctx.beginPath(); ctx.moveTo(bx, base - bh); ctx.quadraticCurveTo(bx + bw / 2, base - bh - 40 * s, bx + bw, base - bh); ctx.fill();
        ctx.fillStyle = '#20252c'; ctx.fillRect(bx, base - bh * 0.34, bw, 5 * s);
      }
      // orbiter: fuselage with nose, cockpit windows, delta wing and tail fin, riding on the tank
      const fw = 30 * s, ox = x + 1 * s, otop = base - h * 0.56, obot = base - h * 0.08;
      g = ctx.createLinearGradient(ox, 0, ox + fw, 0); g.addColorStop(0, '#f2f4f6'); g.addColorStop(0.6, '#d5d9de'); g.addColorStop(1, '#8b929c');
      ctx.fillStyle = '#c9ced5'; ctx.beginPath(); ctx.moveTo(ox - 14 * s, obot - 30 * s); ctx.lineTo(ox + 6 * s, obot - 92 * s); ctx.lineTo(ox + 6 * s, obot); ctx.closePath(); ctx.fill(); // tail fin
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ox, obot); ctx.lineTo(ox, otop + 58 * s); ctx.quadraticCurveTo(ox + 2 * s, otop + 8 * s, ox + fw / 2, otop); ctx.quadraticCurveTo(ox + fw - 2 * s, otop + 8 * s, ox + fw, otop + 58 * s); ctx.lineTo(ox + fw, obot); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e9ecef'; ctx.beginPath(); ctx.moveTo(ox + fw, obot - 130 * s); ctx.lineTo(ox + fw + 58 * s, obot + 6 * s); ctx.lineTo(ox + fw, obot + 6 * s); ctx.closePath(); ctx.fill(); // wing
      ctx.fillStyle = '#15181e'; ctx.beginPath(); ctx.moveTo(ox + 5 * s, otop + 44 * s); ctx.lineTo(ox + fw - 5 * s, otop + 44 * s); ctx.lineTo(ox + fw - 8 * s, otop + 36 * s); ctx.lineTo(ox + 8 * s, otop + 36 * s); ctx.closePath(); ctx.fill(); // windows
      ctx.beginPath(); ctx.moveTo(ox + fw / 2 - 5 * s, otop + 8 * s); ctx.quadraticCurveTo(ox + fw / 2, otop - 2 * s, ox + fw / 2 + 5 * s, otop + 8 * s); ctx.fill(); // nose cap
      // rim light from the floodlights
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,236,200,0.08)'; ctx.fillRect(tx, base - tankH, 4 * s, tankH); ctx.globalCompositeOperation = 'source-over';
      // exhaust
      if (t >= 0 && exit < 0.95) {
        const fl = 0.8 + Math.random() * 0.35, len = Math.min(1, t / 1.2) * (220 * s) * fl * (1 + smooth(0, 8, t) * 1.4), fw = 60 * s;
        ctx.globalCompositeOperation = 'lighter';
        for (const [c, w, l] of [['rgba(255,120,40,0.35)', 1, 1], ['rgba(255,190,90,0.55)', 0.62, 0.8], ['rgba(255,250,230,0.9)', 0.28, 0.5]]) {
          const gg = ctx.createLinearGradient(0, base, 0, base + len * l); gg.addColorStop(0, c); gg.addColorStop(1, 'rgba(255,90,20,0)'); ctx.fillStyle = gg;
          ctx.beginPath(); ctx.moveTo(x - fw * w / 2, base); ctx.quadraticCurveTo(x, base + len * l * 1.12, x + fw * w / 2, base); ctx.closePath(); ctx.fill();
        }
        const glow = ctx.createRadialGradient(x, base + 10 * s, 0, x, base + 10 * s, 220 * s); glow.addColorStop(0, 'rgba(255,170,90,0.2)'); glow.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = glow; ctx.fillRect(x - 260 * s, base - 200 * s, 520 * s, 520 * s);
      }
      ctx.restore();
    }
    drawSmoke(ctx, x, horizon, s, t, alpha) {
      if (t < 0.3) return;
      if (this.frame % 2 === 0 && t < 7) for (let i = 0; i < 2; i++) this.smoke.push({ x: x + (Math.random() - .5) * 60 * s, y: horizon - 6 * s, vx: (Math.random() - .5) * 140 * s, r: 30 * s, life: 0 });
      ctx.save();
      for (const p of this.smoke) {
        p.life += 0.016; p.x += p.vx * 0.016 * (1 - p.life * 0.15); p.r += 42 * s * 0.016; const a = Math.max(0, 0.32 - p.life * 0.06) * alpha;
        if (a <= 0) continue; const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); g.addColorStop(0, `rgba(235,220,205,${a})`); g.addColorStop(1, 'rgba(235,220,205,0)'); ctx.fillStyle = g; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
      this.smoke = this.smoke.filter(p => p.life < 6);
      ctx.restore();
    }
  }
  window.Scene = Scene;
})();
