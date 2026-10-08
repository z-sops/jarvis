/* Microphone meter: shows what the microphone is really hearing, which microphone it is, and lets you pick another one.
   It listens to the "bridge:mic" events of the voice client and never touches the app's logic. */
(function () {
  'use strict';
  const comms = document.querySelector('.panel.comms'), entry = comms && comms.querySelector('.entry');
  if (!comms || !entry || !window.bridge) return;
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid)); return el; };
  const SEGS = 16, segs = Array.from({ length: SEGS }, () => h('i'));
  const state = h('span', { class: 'mb-state' }, 'idle'), dev = h('button', { class: 'mb-dev', type: 'button', title: 'Click to choose the microphone' }, 'no microphone yet'), test = h('button', { class: 'mb-test', type: 'button', title: 'Open only the microphone for 15 seconds and show its level (no internet needed)' }, 'Test mic');
  const find = h('button', { class: 'mb-test mb-find', type: 'button', title: 'Tries every microphone while you speak, and picks the one that hears you' }, 'Find my mic');
  const bar = h('div', { class: 'micbar', role: 'group', 'aria-label': 'Microphone level' }, h('span', { class: 'mb-k' }, 'MIC'), h('div', { class: 'mb-segs' }, ...segs), state, dev, test, find);
  comms.insertBefore(bar, entry);
  const live = () => window.__live, say = t => { try { window.__ui.addMsg('sys', t); } catch {} };

  function render(d) {
    const on = Math.round((d.level || 0) * SEGS);
    segs.forEach((s, i) => { s.className = i < on ? (i >= SEGS - 3 ? 'on hot' : 'on') : ''; });
    const nosig = !d.muted && (d.live || d.testing) && d.silentFor >= 15, active = d.live || d.testing || d.connecting;
    bar.classList.toggle('muted', !!d.muted); bar.classList.toggle('nosig', nosig); bar.classList.toggle('active', !!active); find.classList.toggle('attn', nosig);
    state.textContent = d.muted ? 'MUTED' : nosig ? 'NO SIGNAL' : d.testing ? d.db + ' dB (test)' : d.connecting ? 'connecting' : d.live ? d.db + ' dB' : 'idle';
    dev.textContent = d.device || 'no microphone yet';
    bar.title = d.device ? `Microphone: ${d.device}\nSignal: ${d.db} dB\nAudio engine: ${d.ctx}\nStream: ${d.track}\n\nSpeak: the bar should jump. If it stays empty, Windows is not giving Orbit any sound.` : 'No microphone open. Press the mic button, or "Test mic".';
    const orb = document.getElementById('presence'), speaking = /speaking/i.test((document.getElementById('hud-status') || {}).textContent || '');
    if (orb) orb.classList.toggle('hearing', !!d.hearing && !speaking);
  }
  addEventListener('bridge:mic', e => render(e.detail || {}));
  render({ level: 0 });

  test.addEventListener('click', async () => {
    const l = live(); if (!l) return;
    try { const r = await l.micTest(15); if (r === 'live') say('The voice link is already on: just speak and watch the MIC bar.'); else say('Microphone test for 15 seconds. Speak, and the MIC bar should jump.'); }
    catch (e) { say('I could not open the microphone: ' + e.message + '. Windows Settings > Privacy & security > Microphone: allow desktop apps.'); }
  });

  // "Find my mic": measures every microphone while the user speaks, then applies the best choice.
  let probing = false;
  async function findMic() {
    const l = live(); if (!l || probing || !window.MicProbe) return; probing = true; find.disabled = true; test.disabled = true; bar.classList.add('probing');
    try {
      say('Finding your microphone. Speak out loud and without stopping (count "one, two, three...") for about 20 seconds.');
      const results = await l.probeMics(s => { state.textContent = `testing ${s.i + 1}/${s.n}`; dev.textContent = s.label; });
      const cfg = await bridge.config.get().catch(() => ({})), out = MicProbe.analyse(results, { deviceId: cfg.micDeviceId || '' });
      let patch = out.patch, extra = '';
      if (out.verdict === 'found') {
        state.textContent = 'checking rate';
        const r16 = await l.measureMic(patch.micDeviceId || undefined, { processing: patch.micProcessing, rate16: true }, 1500).catch(e => ({ error: String(e.message || e) }));
        const rv = MicProbe.rateVerdict(out.chosen, r16); patch = { ...patch, micNative: rv.micNative }; extra = rv.note;
      }
      const text = MicProbe.report(results, out) + (extra ? '\nNote: ' + extra : ''); window.__micReport = text; let copied = false; try { await navigator.clipboard.writeText(text); copied = true; } catch { /* the report is still in window.__micReport */ }
      const tail = copied ? ' The full report is copied: you can paste it to me.' : '';
      if (out.verdict === 'found') {
        await bridge.config.save(patch);
        say(`Found it: ${out.chosen.label} (${out.loudest} dB).` + (patch.micProcessing === false ? ' Windows voice processing was silencing it, so I switched that off.' : '') + (extra ? ' ' + extra + '.' : '') + ' Speak now and watch the MIC bar.' + tail);
        try { await l.restartMic(); if (!l.stream) await l.micTest(15); } catch (e) { say('I could not open it: ' + e.message); }
      } else if (out.verdict === 'silent') say(`None of your ${results.length} microphones heard you (the loudest was ${out.loudest} dB). Check that the microphone is not muted (a mute key or switch on the headset or keyboard), that Windows Settings > System > Sound > Input shows the blue bar moving when you speak, and that Settings > Privacy & security > Microphone > "Let desktop apps access your microphone" is on.` + tail);
      else say('Windows did not let Orbit open any microphone. Open Settings > Privacy & security > Microphone and turn on "Let desktop apps access your microphone".' + tail);
    } catch (e) { say('The microphone check failed: ' + e.message); }
    finally { probing = false; find.disabled = false; test.disabled = false; bar.classList.remove('probing'); render(window.__mic || { level: 0 }); }
  }
  find.addEventListener('click', findMic);

  let menu = null; const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  dev.addEventListener('click', async e => {
    e.stopPropagation(); if (menu) return closeMenu();
    let devices = []; try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch {}
    const cfg = await bridge.config.get().catch(() => ({}));
    menu = h('div', { class: 'mb-menu', role: 'menu' }, h('div', { class: 'mb-note' }, 'Choose the microphone Orbit listens to'),
      h('button', { role: 'menuitem', onclick: () => { closeMenu(); findMic(); } }, 'Find my microphone (speak for 20 seconds)'),
      h('button', { role: 'menuitem', class: cfg.micDeviceId ? '' : 'sel', onclick: () => pick('') }, 'Windows default'),
      ...devices.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map(d => h('button', { role: 'menuitem', class: cfg.micDeviceId === d.deviceId ? 'sel' : '', onclick: () => pick(d.deviceId) }, d.label || 'Microphone')));
    if (!devices.length) menu.append(h('div', { class: 'mb-note' }, 'No microphone found. Check that it is plugged in and allowed in Windows privacy settings.'));
    bar.append(menu);
  });
  addEventListener('click', closeMenu); addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  async function pick(id) {
    closeMenu(); await bridge.config.save({ micDeviceId: id });
    const l = live(); if (l) try { await l.restartMic(); if (!l.stream) await l.micTest(15); say(id ? 'Microphone changed.' : 'Using the Windows default microphone.'); } catch (e) { say('That microphone did not open: ' + e.message); }
  }
})();
