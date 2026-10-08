'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const vm = require('vm');

// mic-worklet.js runs inside the browser's audio thread; load it here with the few globals it needs.
function load(sampleRate) {
  const posted = []; let Proc = null;
  class AudioWorkletProcessor { constructor() { this.port = { postMessage: b => posted.push(b) }; } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'mic-worklet.js'), 'utf8'), { AudioWorkletProcessor, sampleRate, registerProcessor: (n, c) => { Proc = c; }, Float32Array, Math });
  return { p: new Proc(), posted };
}
const sine = (freq, rate, seconds) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin(2 * Math.PI * freq * i / rate));
const feed = (p, samples) => { for (let i = 0; i < samples.length; i += 128) p.process([[samples.subarray(i, Math.min(samples.length, i + 128))]]); };
const crossings = a => { let c = 0; for (let i = 1; i < a.length; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) c++; return c; };
const flat = list => Float32Array.from(list.flatMap(b => [...b]));

test('16 kHz in, 16 kHz out: nothing changes, blocks of 800 samples (50 ms)', () => {
  const { p, posted } = load(16000); const s = sine(440, 16000, 0.5); feed(p, s);
  assert.equal(posted.length, 10); assert.ok(posted.every(b => b.length === 800)); const out = flat(posted); for (let i = 0; i < out.length; i += 97) assert.ok(Math.abs(out[i] - s[i]) < 1e-6, 'sample ' + i);
});

test('48 kHz and 44.1 kHz are converted to 16 kHz: right length, right pitch, right loudness', () => {
  for (const rate of [48000, 44100]) {
    const { p, posted } = load(rate); feed(p, sine(440, rate, 1)); const out = flat(posted);
    assert.ok(Math.abs(out.length - (16000 - 800)) <= 800 + 20, `${rate}: about one second of 16 kHz sound came out (${out.length} samples, blocks of 800)`); assert.ok(posted.every(b => b.length === 800));
    const seconds = out.length / 16000, hz = crossings(out) / 2 / seconds; assert.ok(Math.abs(hz - 440) < 6, `${rate}: a 440 Hz tone stays 440 Hz (got ${hz.toFixed(1)})`);
    const peak = Math.max(...out.map(Math.abs)); assert.ok(peak > 0.45 && peak < 0.55, `${rate}: the loudness stays the same (peak ${peak.toFixed(3)})`);
  }
});

test('no gaps or jumps at the block edges (the conversion carries over from one block to the next)', () => {
  const { p, posted } = load(48000); feed(p, sine(300, 48000, 0.6)); const out = flat(posted); let worst = 0;
  for (let i = 1; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - out[i - 1])); assert.ok(worst < 2 * Math.PI * 300 / 16000 * 0.5 + 0.02, 'the biggest step between neighbouring samples is smooth: ' + worst.toFixed(3));
});

test('silence stays silence, and an empty input (no microphone connected yet) is ignored', () => {
  const { p, posted } = load(48000); feed(p, new Float32Array(48000)); assert.ok(flat(posted).every(v => v === 0));
  assert.equal(p.process([[]]), true); assert.equal(p.process([]), true); assert.equal(p.process([[new Float32Array(0)]]), true);
});
