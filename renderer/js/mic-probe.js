/* "Find my mic": decides from the measurements which microphone (and which settings) to use. No page code here, so it can be tested on its own. */
(function (root) {
  'use strict';
  const HEARS = -52;   // dBFS: speech peaks are far above this, an empty or muted input far below
  const num = m => (m && typeof m.peakDb === 'number' ? m.peakDb : -Infinity);
  const loudest = r => Math.max(num(r.raw), num(r.processed));
  const fmt = m => (!m ? 'not measured' : m.error ? `blocked (${m.error})` : `${m.peakDb} dB${m.muted ? ', muted by Windows' : ''}`);

  // results: [{ id, label, raw: { peakDb } | { error }, processed: ... }], current: { deviceId: '' }
  function analyse(results, current = {}) {
    const list = results.filter(r => loudest(r) > -Infinity).sort((a, b) => loudest(b) - loudest(a)); const top = list[0];
    const lines = results.map(r => `${r.label}: without voice processing ${fmt(r.raw)}; with it ${fmt(r.processed)}`);
    if (!top) return { verdict: 'blocked', hears: false, lines, patch: null, chosen: null };
    if (loudest(top) < HEARS) return { verdict: 'silent', hears: false, lines, patch: null, chosen: null, loudest: loudest(top) };
    // follow the Windows default when it is nearly as good as the best one; otherwise pin the best microphone
    const alias = list.find(r => r.id === 'default'), chosen = alias && loudest(alias) >= HEARS && loudest(top) - loudest(alias) <= 6 ? alias : top;
    const processing = !(num(chosen.processed) < HEARS && num(chosen.raw) >= HEARS);
    return { verdict: 'found', hears: true, chosen, lines, loudest: loudest(chosen), patch: { micDeviceId: chosen.id === 'default' ? '' : chosen.id, micProcessing: processing }, changed: (chosen.id === 'default' ? '' : chosen.id) !== (current.deviceId || '') };
  }
  // The same microphone measured through a 16 kHz audio engine: if it is silent there but heard normally elsewhere, the engine should run at the card's own rate.
  function rateVerdict(chosen, rate16) { const ok = loudest(chosen); return ok >= HEARS && num(rate16) < HEARS ? { micNative: true, note: 'the 16 kHz audio engine hears nothing from this microphone; Orbit will use the sound card\u2019s own rate' } : { micNative: false, note: '' }; }
  function report(results, out, when = new Date()) {
    return ['Orbit microphone check ' + when.toISOString().slice(0, 19).replace('T', ' '), ...out.lines, out.verdict === 'found' ? `Chosen: ${out.chosen.label} (${out.loudest} dB)${out.patch && out.patch.micProcessing === false ? ', without voice processing' : ''}` : `Result: ${out.verdict}`].join('\n');
  }
  const api = { HEARS, analyse, rateVerdict, report, fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MicProbe = api;
})(typeof window !== 'undefined' ? window : globalThis);
