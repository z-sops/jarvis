/* First-run commissioning: the user names the AI, picks its voice and gender, says who they are, connects the key. */
(function () {
  'use strict';
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v); }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const STEPS = [['callsign', 'Callsign'], ['voice', 'Voice'], ['commander', 'Commander'], ['uplink', 'Uplink'], ['home', 'Home base'], ['launch', 'Launch']];
  const NAMES = ['Jarvis', 'Friday', 'Nova', 'Orion', 'Zara', 'Aria'];
  const TITLES = ['Commander', 'Captain', 'Boss', 'CEO', 'Sir', "Ma'am"];
  const LANGS = { mix: 'Roman Urdu and English, mixed', en: 'English', ur: 'اردو (Urdu)' };

  function run(cfg, { sfx, onLaunch }) {
    const root = document.getElementById('onboarding'); root.innerHTML = ''; root.hidden = false;
    const d = { aiName: cfg.aiName || '', gender: cfg.gender || 'female', voice: cfg.voice, lang: cfg.lang || 'mix', userName: cfg.userName || '', userTitle: cfg.userTitle || 'Commander', apiKey: cfg.apiKey || '', homeDir: cfg.homeDir, autostart: cfg.autostart !== false, sfx: cfg.sfx !== false };
    let step = -1, keyState = '';
    const list = h('ol', { class: 'ob-list', 'aria-label': 'Pre-flight checklist' });
    const stage = h('div', { class: 'ob-stage' });
    root.append(h('aside', { class: 'ob-side' }, h('div', { class: 'ob-brand' }, 'Orbit', h('span', {}, 'commissioning')), list), stage);

    const summary = i => [
      d.aiName, d.gender === 'female' ? `Female · ${d.voice}` : `Male · ${d.voice}`, d.userName && `${d.userTitle} ${d.userName}`,
      d.apiKey ? 'Key set' : (step > 3 ? 'Offline mode' : ''), d.homeDir.split(/[\\/]/).slice(-2).join('/'), ''
    ][i];
    function paintList() {
      list.innerHTML = '';
      STEPS.forEach(([, label], i) => list.append(h('li', { class: i < step ? 'done' : i === step ? 'now' : '', 'aria-current': i === step ? 'step' : false },
        h('i', { 'aria-hidden': 'true' }), h('div', {}, h('b', {}, label), i < step && summary(i) ? h('small', {}, summary(i)) : null))));
    }
    const go = n => { step = n; paintList(); render(); sfx.click(); };
    const nav = (canNext, nextLabel = 'Continue') => h('div', { class: 'ob-nav' },
      step > 0 ? h('button', { class: 'btn ghost', onclick: () => go(step - 1) }, 'Back') : h('span'),
      h('button', { class: 'btn primary', id: 'ob-next', disabled: !canNext, onclick: next }, nextLabel));
    const setNext = ok => { const b = document.getElementById('ob-next'); if (b) b.disabled = !ok; };
    let validate = () => true;
    async function next() {
      if (!validate()) return;
      if (step < STEPS.length - 1) return go(step + 1);
      const b = document.getElementById('ob-next'); b.disabled = true; b.textContent = 'Commissioning…';
      try { const done = await bridge.config.commission(d); onLaunch(done); } catch (e) { b.disabled = false; b.textContent = 'Begin launch'; stage.querySelector('.ob-err').textContent = e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
    }
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && step >= 0 && !e.target.closest('button,a,select')) { e.preventDefault(); if (!document.getElementById('ob-next')?.disabled) next(); } });

    function q(title, sub) { return [h('h1', {}, title), sub ? h('p', { class: 'ob-sub' }, sub) : null]; }
    function chips(items, current, pick) { return h('div', { class: 'chips' }, items.map(x => h('button', { type: 'button', class: 'chip' + (x === current ? ' on' : ''), onclick: () => pick(x) }, x))); }

    function render() {
      stage.innerHTML = ''; validate = () => true;
      if (step === -1) return renderIntro();
      const id = STEPS[step][0], body = h('div', { class: 'ob-step', key: id });
      if (id === 'callsign') {
        const input = h('input', { class: 'big', id: 'f-name', maxlength: 24, placeholder: 'Type a name', value: d.aiName, autocomplete: 'off', spellcheck: 'false' });
        input.addEventListener('input', () => { d.aiName = input.value.trim(); setNext(!!d.aiName); paintChips(); });
        const chipBox = h('div'); const paintChips = () => { chipBox.replaceChildren(chips(NAMES, d.aiName, n => { d.aiName = n; input.value = n; setNext(true); paintChips(); input.focus(); })); }; paintChips();
        body.append(...q('What should I be called?', "This is the name you'll say to wake me, and the name I'll answer to. Anything works."), input, chipBox, h('p', { class: 'hint' }, 'You can rename me later in Settings.'));
        validate = () => !!d.aiName; setTimeout(() => input.focus(), 50);
      }
      if (id === 'voice') {
        const voices = h('div', { class: 'voices' }), lang = h('select', { id: 'f-lang', 'aria-label': 'Language' }, Object.entries(LANGS).map(([k, v]) => h('option', { value: k, selected: k === d.lang }, v)));
        lang.addEventListener('change', () => (d.lang = lang.value));
        const paint = () => {
          voices.replaceChildren(h('div', { class: 'gender', role: 'radiogroup', 'aria-label': 'Gender' }, ['female', 'male'].map(g => h('button', { type: 'button', role: 'radio', 'aria-checked': String(d.gender === g), class: 'gbtn' + (d.gender === g ? ' on' : ''), onclick: () => { d.gender = g; d.voice = cfg.voices[g][0].id; paint(); } }, h('b', {}, g === 'female' ? 'Female' : 'Male'), h('small', {}, g === 'female' ? 'She / her' : 'He / him')))),
            h('div', { class: 'vlist' }, cfg.voices[d.gender].map(v => h('button', { type: 'button', class: 'vopt' + (v.id === d.voice ? ' on' : ''), onclick: () => { d.voice = v.id; paint(); } }, h('b', {}, v.id), h('small', {}, v.note)))));
        }; paint();
        body.append(...q(`How should ${d.aiName || 'I'} sound?`, 'Pick a gender and a voice. It also decides how I speak about myself in Urdu.'), voices, h('label', { class: 'field' }, h('span', {}, 'Speak with me in'), lang));
      }
      if (id === 'commander') {
        const input = h('input', { class: 'big', id: 'f-user', maxlength: 40, placeholder: 'Your name', value: d.userName, autocomplete: 'off', spellcheck: 'false' });
        input.addEventListener('input', () => { d.userName = input.value.trim(); setNext(!!d.userName); });
        const tbox = h('div'); const paintT = () => tbox.replaceChildren(chips(TITLES, d.userTitle, t => { d.userTitle = t; custom.value = ''; paintT(); }));
        const custom = h('input', { class: 'small', placeholder: 'or type your own title', maxlength: 24, 'aria-label': 'Custom title' }); custom.addEventListener('input', () => { if (custom.value.trim()) { d.userTitle = custom.value.trim(); paintT(); } }); paintT();
        body.append(...q('And who is in command?', `Tell me your name, and what I should call you.`), input, h('div', { class: 'ob-row' }, h('span', { class: 'lab' }, 'Call you'), tbox, custom));
        validate = () => !!d.userName; setTimeout(() => input.focus(), 50);
      }
      if (id === 'uplink') {
        const key = h('input', { class: 'big mono', id: 'f-key', type: 'password', placeholder: 'Paste your Gemini API key', value: d.apiKey, autocomplete: 'off', spellcheck: 'false' });
        const status = h('span', { class: 'keystatus', role: 'status' }, keyState);
        key.addEventListener('input', () => { d.apiKey = key.value.trim(); keyState = ''; status.textContent = ''; status.className = 'keystatus'; });
        const test = h('button', { type: 'button', class: 'btn ghost', onclick: async () => { if (!d.apiKey) return; status.className = 'keystatus'; status.textContent = 'Testing…'; const r = await bridge.testKey(d.apiKey); status.className = 'keystatus ' + (r.ok ? 'ok' : 'bad'); status.textContent = keyState = r.ok ? 'Key works' : 'Rejected: ' + r.error; } }, 'Test key');
        body.append(...q('Connect the uplink', 'My thinking and my voice run on Google Gemini. The key is saved only on this computer.'), key,
          h('div', { class: 'ob-row' }, test, status, h('a', { href: '#', class: 'link', onclick: e => { e.preventDefault(); bridge.openExternal('https://aistudio.google.com/apikey'); } }, 'Get a free key')),
          h('button', { type: 'button', class: 'link skip', onclick: () => { d.apiKey = ''; go(step + 1); } }, 'Skip for now. I will be offline until a key is added.'));
        validate = () => true; setTimeout(() => key.focus(), 50);
      }
      if (id === 'home') {
        const path = h('code', { class: 'path' }, d.homeDir);
        const chk = (label, sub, key) => { const i = h('input', { type: 'checkbox', checked: d[key] }); i.addEventListener('change', () => (d[key] = i.checked)); return h('label', { class: 'check' }, i, h('span', {}, h('b', {}, label), h('small', {}, sub))); };
        body.append(...q('Where should the ship live?', 'Every crew member gets a folder here with a brain, a jobs folder and a skills folder. So do I.'),
          h('div', { class: 'ob-row' }, path, h('button', { type: 'button', class: 'btn ghost', onclick: async () => { const p = await bridge.pickDir(); if (p) { d.homeDir = p.replace(/[\\/]$/, '') + (/BridgeHome$/i.test(p) ? '' : (p.includes('\\') ? '\\BridgeHome' : '/BridgeHome')); path.textContent = d.homeDir; } } }, 'Change folder')),
          chk('Start when I sign in', 'I stay in the tray and wake with Ctrl+Alt+J.', 'autostart'), chk('Ship sounds', 'Launch rumble, ventilation hum, chimes.', 'sfx'));
      }
      if (id === 'launch') {
        const dl = h('dl', { class: 'sum' }, [['Callsign', d.aiName], ['Voice', `${d.gender === 'female' ? 'Female' : 'Male'}, ${d.voice}`], ['Language', LANGS[d.lang]], ['In command', `${d.userTitle} ${d.userName}`], ['Uplink', d.apiKey ? 'Connected' : 'Offline until a key is added'], ['Home', d.homeDir]].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
        body.append(...q('Ready for launch', `${d.aiName} is standing by for your orders, ${d.userTitle}.`), dl, h('p', { class: 'ob-err', role: 'alert' }));
      }
      body.append(nav(validate(), id === 'launch' ? 'Begin launch' : 'Continue')); stage.append(body);
    }
    function renderIntro() {
      const lines = ['Orbit OS. Cold start.', 'Scanning crew manifest… no crew found.', 'Scanning command roster… no commander on record.', 'Commissioning required.'];
      const box = h('pre', { class: 'boot', 'aria-live': 'polite' }), btn = h('button', { class: 'btn primary', hidden: true, onclick: () => go(0) }, 'Begin commissioning');
      stage.append(h('div', { class: 'ob-step' }, box, btn)); let i = 0;
      const tick = () => { if (i < lines.length) { box.append(lines[i++] + '\n'); sfx.blip(300 + i * 60, 0.05, 'square', 0.03); setTimeout(tick, 520); } else { btn.hidden = false; btn.focus(); } };
      setTimeout(tick, 500);
    }
    paintList(); render();
  }
  window.Onboarding = { run };
})();
