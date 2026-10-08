/* Power-down sequence: quitting Orbit is a short procedure, and every line is a real step (voice, crew, browser, comms). */
(() => {
  'use strict';
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return el; };
  const root = h('section', { id: 'shutdown', role: 'dialog', 'aria-live': 'assertive', 'aria-label': 'Power-down sequence' });
  document.body.append(root);
  let running = false, fast = false, escHandler = null;
  const sleep = ms => new Promise(r => setTimeout(r, fast ? 0 : ms));
  const sfx = (n, ...a) => { try { window.SFX && SFX[n] && SFX[n](...a); } catch { /* sound is optional */ } };
  const show = (...kids) => { root.textContent = ''; root.append(h('div', { class: 'sd-box' }, ...kids)); };
  const onEsc = fn => { offEsc(); escHandler = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fn(); } }; addEventListener('keydown', escHandler, true); };
  const offEsc = () => { if (escHandler) removeEventListener('keydown', escHandler, true); escHandler = null; };
  function close() { offEsc(); root.className = ''; root.textContent = ''; document.body.classList.remove('phase-shutdown'); running = false; }

  // Crew is still working: quitting would stop them. Resolves true to go on.
  function confirmCrew(n) {
    return new Promise(res => {
      const done = v => { offEsc(); res(v); };
      show(h('div', { class: 'sd-title' }, 'Crew still on duty'), h('div', { class: 'sd-text' }, `${n} crew member${n === 1 ? ' is' : 's are'} working on a job right now.`, h('br'), 'Powering down stops them where they are.'),
        h('div', { class: 'sd-row' }, h('button', { class: 'sd-btn', type: 'button', onclick: () => done(false) }, 'Stay online'), h('button', { class: 'sd-btn go', type: 'button', onclick: () => done(true) }, 'Stand down and power down')));
      onEsc(() => done(false));
    });
  }
  // T-3, T-2, T-1: nothing has been touched yet, so it can still be aborted.
  async function countdown() {
    let aborted = false; const num = h('div', { class: 'sd-num' }, 'T\u22123');
    show(h('div', { class: 'sd-title' }, 'Power-down sequence'), num, h('div', { class: 'sd-text' }, 'Systems will be stood down in order.'), h('div', { class: 'sd-row' }, h('button', { class: 'sd-btn', type: 'button', onclick: () => { aborted = true; } }, 'Abort  (Esc)'), h('button', { class: 'sd-btn go', type: 'button', onclick: () => { fast = true; aborted = false; } }, 'Skip the show')));
    onEsc(() => { aborted = true; });
    for (let n = 3; n >= 1 && !fast; n--) { num.textContent = 'T\u2212' + n; sfx('tick'); for (let i = 0; i < 10 && !aborted && !fast; i++) await sleep(100); if (aborted) break; }
    offEsc(); return !aborted;
  }
  const STEPS = [
    ['Voice link', async () => { const l = window.__live; if (l && l.want) { l.stop(); return { ok: true, detail: 'closed' }; } return { ok: true, detail: 'not active' }; }],
    ['Crew engines', () => bridge.shutdown.step('crew')],
    ['Orbit Browser', () => bridge.shutdown.step('browser')],
    ['Comms hub', () => bridge.shutdown.step('comms')]
  ];
  async function begin() {
    if (running) return; try { await run(); } catch (e) { console.error('power-down failed, quitting directly:', e); bridge.win.quit(); }
  }
  async function run() { const cfg = await bridge.config.get().catch(() => ({}));
    if (!cfg.commissioned || cfg.shutdownSequence === false || document.body.classList.contains('phase-onboard')) return bridge.win.quit();
    running = true; fast = false; root.className = 'on'; const dog = setTimeout(() => bridge.win.quit(), 40000);   // never trap the user in this screen
    const busy = await Promise.resolve().then(() => bridge.stop.busy()).catch(() => ({ crew: 0 }));
    if (busy.crew > 0 && !(await confirmCrew(busy.crew))) { clearTimeout(dog); return close(); }
    if (!(await countdown())) { clearTimeout(dog); return close(); }
    document.body.classList.add('phase-shutdown'); sfx('powerdown');
    const list = h('div', { class: 'sd-list' }), bar = h('i'); const skip = h('button', { class: 'sd-skip', type: 'button', onclick: () => { fast = true; } }, 'Skip the show');
    show(h('div', { class: 'sd-title' }, 'Power-down in progress'), list, h('div', { class: 'sd-bar' }, bar), skip);
    for (let i = 0; i < STEPS.length; i++) {
      const [name, run] = STEPS[i], st = h('em', {}, '\u2026'), det = h('span', {}, ''), line = h('div', { class: 'sd-line' }, h('i'), h('b', {}, name), det, st); list.append(line);
      let r; const t0 = Date.now(); try { r = await run(); } catch (e) { r = { ok: false, detail: e.message }; }
      const left = 650 - (Date.now() - t0); if (left > 0) await sleep(left);
      line.className = 'sd-line ' + (r && r.ok ? 'ok' : 'bad'); st.textContent = r && r.ok ? 'OK' : 'FAILED'; det.textContent = (r && r.detail) || ''; sfx('click'); bar.style.width = Math.round(((i + 1) / STEPS.length) * 100) + '%';
    }
    skip.remove(); await sleep(500);
    show(h('div', { class: 'sd-final' }, 'ORBIT OFFLINE'), h('div', { class: 'sd-text' }, `Goodnight, ${[cfg.userTitle, cfg.userName].filter(Boolean).join(' ') || 'there'}.`));
    sfx('chime'); await sleep(1700); if (!fast) { root.classList.add('collapse'); await sleep(800); }
    clearTimeout(dog); bridge.win.quit();
  }
  bridge.onBus(({ type }) => { if (type === 'shutdown:request') { bridge.shutdown.ack(); begin(); } });
  window.__shutdown = { begin, running: () => running, confirmCrew };
})();
