/* The Memory screen: everything Laila remembers, in plain sight and yours to change. */
(() => {
  'use strict';
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return el; };
  const S = { tab: 'you', d: null, skill: null, editing: null };
  const when = t => { try { return new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return t; } };
  const size = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

  const title = h('h2', {}, 'Laila\u2019s memory'), path = h('div', { class: 'mm-path' }), body = h('div', {});
  const open = h('button', { class: 'mm-btn', type: 'button', onclick: () => bridge.memory.open() }, 'Open the folder');
  const tabs = h('div', { class: 'mm-tabs', role: 'tablist' });
  const root = h('section', { id: 'memory', 'aria-label': 'Memory' }, h('div', { class: 'mm-wrap' }, h('div', { class: 'mm-head' }, h('div', {}, title, h('p', {}, 'What your assistant knows about you and how she does her work. It is all plain files on your computer: you can read, change or delete anything here. Notes marked with a pin are rules she always keeps in mind.'), path), open), tabs, body));
  document.body.append(root);

  async function load() { const r = await bridge.memory.get(); if (!r.ok) return; S.d = r; path.textContent = r.folder; paint(); }
  function paint() {
    const d = S.d; if (!d) return; title.textContent = (d.profile.aiName || 'Laila') + '\u2019s memory';
    tabs.textContent = ''; for (const [id, label] of [['you', 'About you'], ['notes', `Notes (${d.notes.length})`], ['skills', `Skills (${d.skills.length})`], ['words', 'Voice words'], ['files', 'Files']]) tabs.append(h('button', { class: 'mm-tab' + (S.tab === id ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; if (id === 'files') load(); else paint(); } }, label));   // the file list is read fresh each time
    body.textContent = ''; body.append(S.tab === 'you' ? you() : S.tab === 'notes' ? notes() : S.tab === 'skills' ? skills() : S.tab === 'words' ? words() : files());
  }

  /* ---------- about you ---------- */
  function you() {
    const p = S.d.profile, name = h('input', { class: 'mm-in', type: 'text', maxlength: 40, value: p.userName }), ttl = h('input', { class: 'mm-in', type: 'text', maxlength: 24, value: p.userTitle, placeholder: 'none' });
    const say = h('div', { class: 'mm-say' }), st = h('div', { class: 'mm-status' });
    const preview = () => { const n = name.value.trim() || 'you', t = ttl.value.trim(); say.textContent = t ? `${p.aiName || 'Laila'} will call you \u201C${t}\u201D or \u201C${n}\u201D.` : `${p.aiName || 'Laila'} will call you \u201C${n}\u201D, and nothing else.`; };
    name.addEventListener('input', preview); ttl.addEventListener('input', preview); preview();
    const save = h('button', { class: 'mm-btn go', type: 'button', onclick: async () => { st.className = 'mm-status'; st.textContent = 'Saving\u2026'; const r = await bridge.memory.profile({ userName: name.value, userTitle: ttl.value }); if (!r.ok) { st.className = 'mm-status bad'; st.textContent = r.error; return; } S.d.profile = r.profile; st.className = 'mm-status ok'; st.textContent = 'Saved. It applies from the next thing she says.'; } }, 'Save');
    return h('div', { class: 'mm-card' }, h('div', { class: 'mm-row' }, h('label', { class: 'mm-f' }, 'Your name', name), h('label', { class: 'mm-f' }, 'Title (leave empty for none)', ttl, h('small', {}, 'Something like Commander or Boss. Empty means she uses only your name.'))), say, h('div', { class: 'mm-row' }, save, st),
      h('small', { style: 'color:var(--dimmer);font:12px/1.6 var(--m)' }, 'You can also just tell her: \u201CMujhe Zee kaho.\u201D She saves it here by herself.'));
  }

  /* ---------- notes ---------- */
  function notes() {
    const add = h('input', { class: 'mm-in', type: 'text', maxlength: 500, placeholder: 'A fact or rule for her to remember, for example: I prefer short answers', 'aria-label': 'New note' }), pin = h('input', { type: 'checkbox', id: 'mm-pinnew' }), st = h('div', { class: 'mm-status' });
    const go = async () => { const v = add.value.trim(); if (!v) return; const r = await bridge.memory.noteAdd(v, pin.checked ? true : undefined); if (!r.ok) { st.className = 'mm-status bad'; st.textContent = r.error; return; } add.value = ''; pin.checked = false; S.d.notes = r.notes; paint(); };
    add.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    const list = h('div', { class: 'mm-notes' }); const items = [...S.d.notes].reverse();
    if (!items.length) list.append(h('div', { class: 'mm-empty' }, 'Nothing yet. When you tell her something to remember, or add a note here, it appears in this list.'));
    for (const n of items) {
      const tx = h('div', { class: 'tx' }, n.text, n.t ? h('small', {}, n.t) : null);
      list.append(h('div', { class: 'mm-note' + (n.pin ? ' pin' : '') },
        h('button', { class: 'mm-pin' + (n.pin ? ' on' : ''), type: 'button', title: n.pin ? 'Pinned: always in her mind. Click to unpin' : 'Pin: always keep in her mind', onclick: async () => { const r = await bridge.memory.noteUpdate(n.id, { pin: !n.pin }); if (r.ok) { S.d.notes = r.notes; paint(); } } }, '\uD83D\uDCCC'), tx,
        h('button', { class: 'mm-btn', type: 'button', onclick: () => { const inp = h('input', { class: 'mm-in', type: 'text', value: n.text, maxlength: 500 }); tx.replaceWith(inp); inp.focus(); const done = async () => { const r = await bridge.memory.noteUpdate(n.id, { text: inp.value }); if (r.ok) S.d.notes = r.notes; paint(); }; inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(); if (e.key === 'Escape') paint(); }); inp.addEventListener('blur', done); } }, 'Edit'),
        h('button', { class: 'mm-btn danger', type: 'button', onclick: async () => { if (!confirm('Forget this note?')) return; const r = await bridge.memory.noteRemove(n.id); if (r.ok) { S.d.notes = r.notes; paint(); } } }, 'Forget')));
    }
    return h('div', { class: 'mm-card' }, h('div', { class: 'mm-row' }, add, h('label', { class: 'mm-row', style: 'font:12.5px var(--f);color:var(--dim)' }, pin, 'Pin'), h('button', { class: 'mm-btn go', type: 'button', onclick: go }, 'Remember')), st, list);
  }

  /* ---------- skills ---------- */
  async function editSkill(slug) { if (slug) { const r = await bridge.memory.skillGet(slug); if (!r.ok) return; S.editing = { ...r.skill, isNew: false }; } else S.editing = { slug: '', title: '', description: '', body: '', isNew: true }; paint(); }
  function skills() {
    const e = S.editing, list = h('div', { class: 'mm-slist' }); if (!S.d.skills.length) list.append(h('div', { class: 'mm-empty' }, 'No skills yet.'));
    for (const s of S.d.skills) list.append(h('button', { class: 'mm-s' + (e && e.slug === s.slug ? ' on' : ''), type: 'button', onclick: () => editSkill(s.slug) }, h('b', {}, s.title), h('span', {}, s.description)));
    list.append(h('button', { class: 'mm-btn', type: 'button', onclick: () => editSkill(null) }, '+ New skill'));
    let right; if (!e) right = h('div', { class: 'mm-empty' }, 'A skill is a set of steps for one kind of job. She sees each skill\u2019s name and one line; when a job matches, she reads the steps and follows them. Pick one to read or change it, or make a new one. She can also add skills herself when you teach her something.');
    else {
      const t = h('input', { class: 'mm-in', type: 'text', maxlength: 80, value: e.title, placeholder: 'Name, for example: Weekly review' }), d = h('input', { class: 'mm-in', type: 'text', maxlength: 200, value: e.description, placeholder: 'One line: when should she use it?' }), b = h('textarea', { class: 'mm-ta', placeholder: '- Step one\n- Step two' }), st = h('div', { class: 'mm-status' }); b.value = e.body;
      right = h('div', { class: 'mm-card' }, h('label', { class: 'mm-f' }, 'Name', t), h('label', { class: 'mm-f' }, 'When to use it', d), h('label', { class: 'mm-f' }, 'Steps', b), st,
        h('div', { class: 'mm-row' }, h('button', { class: 'mm-btn go', type: 'button', onclick: async () => { const r = await bridge.memory.skillSave({ slug: e.slug || undefined, title: t.value, description: d.value, body: b.value }); if (!r.ok) { st.className = 'mm-status bad'; st.textContent = r.error; return; } S.d.skills = r.skills; S.editing = { ...r.skill, isNew: false }; paint(); } }, 'Save'),
          e.isNew ? null : h('button', { class: 'mm-btn danger', type: 'button', onclick: async () => { if (!confirm('Delete this skill?')) return; const r = await bridge.memory.skillRemove(e.slug); if (r.ok) { S.d.skills = r.skills; S.editing = null; paint(); } } }, 'Delete')));
    }
    return h('div', { class: 'mm-skills' }, list, right);
  }

  /* ---------- voice words: what the microphone writes, and what you said ---------- */
  function words() {
    const box = h('div', { class: 'mm-card' }), st = h('div', { class: 'mm-status' }); let rows = [];
    const draw = () => { box.textContent = ''; box.append(h('div', { class: 'mm-say' }, 'The microphone sometimes writes a word wrongly (your name as \u201Cji\u201D, a project name in pieces). Add the wrong way and the right way here: from then on it is shown, and stored, the right way. Whole words only; capital letters do not matter.'));
      const list = h('div', { class: 'mm-notes' }); if (!rows.length) list.append(h('div', { class: 'mm-empty' }, 'Nothing yet. For example: the microphone writes \u201Cji\u201D and you said \u201CZee\u201D.'));
      rows.forEach((r, i) => { const a = h('input', { class: 'mm-in', type: 'text', maxlength: 40, value: r.heard, placeholder: 'The microphone writes', 'aria-label': 'The microphone writes' }), b = h('input', { class: 'mm-in', type: 'text', maxlength: 60, value: r.meant, placeholder: 'I said', 'aria-label': 'I said' }); a.addEventListener('input', () => (r.heard = a.value)); b.addEventListener('input', () => (r.meant = b.value)); list.append(h('div', { class: 'mm-row' }, a, h('span', { style: 'color:var(--dim)' }, '\u2192'), b, h('button', { class: 'mm-btn danger', type: 'button', onclick: () => { rows.splice(i, 1); draw(); } }, 'Remove'))); });
      box.append(list, h('div', { class: 'mm-row' }, h('button', { class: 'mm-btn', type: 'button', onclick: () => { if (rows.length < 200) { rows.push({ heard: '', meant: '' }); draw(); } } }, '+ Add a word'), h('button', { class: 'mm-btn go', type: 'button', onclick: async () => { const r = await bridge.memory.glossarySet(rows); if (!r.ok) return say2(false, r.error); rows = r.words; say2(true, 'Saved. It applies to the next thing the microphone writes.'); draw(); } }, 'Save'), st)); };
    const say2 = (ok, t) => { st.className = 'mm-status ' + (ok ? 'ok' : 'bad'); st.textContent = t; };
    bridge.memory.glossaryGet().then(r => { rows = r.ok ? r.words : []; draw(); }); draw(); return box;
  }

  /* ---------- files ---------- */
  function files() {
    const rows = S.d.files.map(f => h('tr', {}, h('td', {}, f.path), h('td', {}, size(f.size)), h('td', {}, when(f.mtime))));
    return h('div', { class: 'mm-card' }, h('div', { class: 'mm-status' }, S.d.folder), rows.length ? h('table', { class: 'mm-files' }, h('tbody', {}, rows)) : h('div', { class: 'mm-empty' }, 'The folder is empty.'));
  }

  // She can change how she addresses you in chat: the screen and the interface follow at once.
  bridge.onBus(({ type }) => { if (type === 'profile:changed') { if (window.__refreshCfg) __refreshCfg(); if (S.d) load(); } });
  // a shortcut on the home screen
  const tryButton = () => { const bar = document.querySelector('.sys-actions'); if (bar && !bar.querySelector('#open-memory')) bar.prepend(h('button', { class: 'mini', id: 'open-memory', type: 'button', onclick: () => window.__ws && __ws.show('memory') }, 'Memory'), ' '); };
  tryButton(); setTimeout(tryButton, 1500);
  window.__memory = { enter: () => { S.editing = null; load(); }, leave: () => {}, state: () => S };
})();
