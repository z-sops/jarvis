/* Small synthesized ship sounds: launch rumble, countdown ticks, chimes, low ventilation hum. No audio files. */
(function () {
  'use strict';
  let ac = null, master = null, enabled = true, hum = null;
  function ctx() {
    if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function noise(sec, brown) {
    const n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  function env(g, t0, a, hold, r, peak) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.setValueAtTime(peak, t0 + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + r); }
  const SFX = {
    enable(v) { enabled = !!v; if (!v) SFX.hum(false); },
    blip(freq = 660, dur = 0.08, type = 'sine', vol = 0.07, delay = 0) {
      if (!enabled) return; const a = ctx(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
      o.type = type; o.frequency.value = freq; env(g, t, 0.005, dur * 0.4, dur * 0.6, vol); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    },
    tick() { SFX.blip(880, 0.07, 'square', 0.05); },
    powerdown() {
      if (!enabled) return; const a = ctx(), t = a.currentTime, o = a.createOscillator(), g = a.createGain(), lp = a.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(28, t + 2.2); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(70, t + 2.2);
      env(g, t, 0.05, 1.0, 1.1, 0.08); o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + 2.4); SFX.hum(false);
    },
    click() { SFX.blip(1200, 0.03, 'triangle', 0.035); },
    chime() { SFX.blip(523, 0.5, 'sine', 0.07); SFX.blip(784, 0.7, 'sine', 0.06, 0.14); SFX.blip(1046, 0.9, 'sine', 0.04, 0.3); },
    alert() { SFX.blip(440, 0.12, 'square', 0.05); SFX.blip(330, 0.16, 'square', 0.05, 0.14); },
    rumble(sec = 12, peak = 0.9) {
      if (!enabled) return; const a = ctx(), t = a.currentTime;
      const src = a.createBufferSource(); src.buffer = noise(sec, true); const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(90, t); lp.frequency.linearRampToValueAtTime(260, t + sec * 0.5);
      const g = a.createGain(); env(g, t, sec * 0.18, sec * 0.5, sec * 0.3, peak); src.connect(lp); lp.connect(g); g.connect(master); src.start(t);
      const c = a.createBufferSource(); c.buffer = noise(sec, false); const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6;
      const cg = a.createGain(); env(cg, t, sec * 0.12, sec * 0.4, sec * 0.4, peak * 0.09); c.connect(bp); bp.connect(cg); cg.connect(master); c.start(t);
    },
    hum(on) {
      if (!enabled && on) return;
      if (!on) { if (hum) { hum.g.gain.linearRampToValueAtTime(0.0001, ac.currentTime + 1); const h = hum; setTimeout(() => { try { h.stop(); } catch {} }, 1200); hum = null; } return; }
      if (hum) return; const a = ctx(), g = a.createGain(); g.gain.value = 0.0001; g.gain.linearRampToValueAtTime(0.035, a.currentTime + 3); g.connect(master);
      const o1 = a.createOscillator(), o2 = a.createOscillator(); o1.frequency.value = 54; o2.frequency.value = 81; o2.type = 'triangle';
      const n = a.createBufferSource(); n.buffer = noise(4, true); n.loop = true; const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      o1.connect(g); o2.connect(g); n.connect(lp); lp.connect(g); o1.start(); o2.start(); n.start();
      hum = { g, stop() { o1.stop(); o2.stop(); n.stop(); } };
    }
  };
  window.SFX = SFX;
})();
