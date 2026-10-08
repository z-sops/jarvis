'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const P = require(path.join(__dirname, '..', 'renderer', 'js', 'mic-probe.js'));

const dev = (id, label, raw, processed) => ({ id, label, raw: typeof raw === 'string' ? { error: raw } : { peakDb: raw }, processed: typeof processed === 'string' ? { error: processed } : { peakDb: processed } });

test('the usual case: Windows default is an empty jack, the headset hears you: the headset is chosen', () => {
  const r = [dev('default', 'Default - Microphone (High Definition Audio Device)', -88, -90), dev('communications', 'Communications - Microphone (High Definition Audio Device)', -88, -91), dev('h1', 'Headset Microphone (USB Audio)', -24, -22), dev('w1', 'Webcam Microphone', -61, -58)];
  const o = P.analyse(r, { deviceId: '' }); assert.equal(o.verdict, 'found'); assert.equal(o.chosen.id, 'h1'); assert.equal(o.patch.micDeviceId, 'h1'); assert.equal(o.patch.micProcessing, true); assert.equal(o.changed, true);
});

test('when the Windows default is nearly as good as the best one, Orbit keeps following the default', () => {
  const o = P.analyse([dev('default', 'Default - Microphone', -30, -29), dev('m1', 'Microphone', -27, -26)], { deviceId: '' }); assert.equal(o.chosen.id, 'default'); assert.equal(o.patch.micDeviceId, ''); assert.equal(o.changed, false);
  const far = P.analyse([dev('default', 'Default', -50, -49), dev('m1', 'Microphone', -25, -24)], { deviceId: '' }); assert.equal(far.chosen.id, 'm1', 'more than 6 dB louder: pinned');
});

test('voice processing that turns the sound into silence is switched off', () => {
  const o = P.analyse([dev('default', 'Default - Microphone', -30, -95)], {}); assert.equal(o.verdict, 'found'); assert.equal(o.patch.micProcessing, false);
  const fine = P.analyse([dev('default', 'Default', -35, -31)], {}); assert.equal(fine.patch.micProcessing, true);
});

test('nobody heard anything: say so; or every microphone was refused: say that', () => {
  const s = P.analyse([dev('default', 'Default', -90, -92), dev('m1', 'Mic', -80, -85)], {}); assert.equal(s.verdict, 'silent'); assert.equal(s.patch, null); assert.equal(s.hears, false);
  const b = P.analyse([dev('default', 'Default', 'NotAllowedError: Permission denied', 'NotAllowedError: Permission denied')], {}); assert.equal(b.verdict, 'blocked'); assert.match(b.lines[0], /blocked \(NotAllowedError/);
  assert.equal(P.analyse([], {}).verdict, 'blocked');
});

test('the 16 kHz check: silent there but fine elsewhere means "use the sound card\'s rate"', () => {
  const chosen = dev('default', 'Default', -30, -28); assert.equal(P.rateVerdict(chosen, { peakDb: -95 }).micNative, true); assert.equal(P.rateVerdict(chosen, { peakDb: -31 }).micNative, false); assert.equal(P.rateVerdict(chosen, { error: 'x' }).micNative, true);
  assert.equal(P.rateVerdict(dev('d', 'D', -90, -90), { peakDb: -95 }).micNative, false, 'nothing heard anywhere: not the rate');
});

test('the report is plain text that can be pasted to someone', () => {
  const r = [dev('default', 'Default - Microphone (High Definition Audio Device)', -88, -90), dev('h1', 'Headset', -24, -22)]; const o = P.analyse(r, {}); const text = P.report(r, o, new Date('2026-09-20T18:30:00Z'));
  assert.match(text, /^Orbit microphone check 2026-09-20 18:30:00/); assert.match(text, /Default - Microphone .*without voice processing -88 dB; with it -90 dB/); assert.match(text, /Chosen: Headset \(-22 dB\)/);
  assert.match(P.report(r, P.analyse([dev('a', 'A', -95, -95)], {}), new Date()), /Result: silent/);
});
