/* The Connectors screen and permission hub: outside services and Orbit's own tools the crew can use, and what each one may do:
   free (runs at once), ask (Orbit asks you first) or blocked. Read-only first. */
(() => {
  'use strict';
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return el; };
  const S = { catalog: [], list: [], native: [], engine: 'builtin', crew: [], open: new Set(), openAgents: new Set(), feed: [], identityNotices: new Map() };
  const host = u => { try { const x = new URL(u); return x.host + (x.pathname !== '/' ? x.pathname : ''); } catch { return u; } };
  const LEVELS = [['free', 'Free'], ['ask', 'Ask me'], ['blocked', 'Blocked']];
  const levelSelect = (cur, onchange) => h('select', { class: 'cn-btn cn-lv ' + cur, 'aria-label': 'What the crew may do', onchange }, LEVELS.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
  const counts = tools => { const n = { free: 0, ask: 0, blocked: 0 }; for (const t of tools) n[t.level] = (n[t.level] || 0) + 1; return n; };
  const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const note = h('div', { class: 'cn-note', hidden: true });
  const listBox = h('div', { class: 'cn-list' }), nativeBox = h('div', { class: 'cn-list' }), catBox = h('div', { class: 'cn-cat' }), feedBox = h('div', { class: 'cn-feed' });
  const form = h('div', { class: 'cn-form', role: 'dialog', 'aria-label': 'Add a connector' });
  const root = h('section', { id: 'connectors', 'aria-label': 'Connectors' }, h('div', { class: 'cn-wrap' },
    h('div', { class: 'cn-head' }, h('h2', {}, 'Connectors and permissions'), h('p', {}, 'Outside services your crew can use, and a few of Orbit\u2019s own tools. The crew never gets your tokens: Orbit talks to the service for them. Every tool is Free (runs at once), Ask me (a question appears each time) or Blocked. Everything starts read-only, and every call is written to the Logs.')),
    note, h('div', { class: 'cn-sec' }, h('h3', {}, 'Connected'), listBox), h('div', { class: 'cn-sec' }, h('h3', {}, 'Orbit\u2019s own tools for the crew'), nativeBox),
    h('div', { class: 'cn-sec' }, h('h3', {}, 'Add a connector'), catBox), h('div', { class: 'cn-sec' }, h('h3', {}, 'What the crew did'), feedBox)), form);
  document.body.append(root);

  async function refresh() {
    const [r, crew] = await Promise.all([bridge.connectors.list(), bridge.agents.list().catch(() => [])]); if (!r.ok) return;
    S.catalog = r.catalog; S.list = r.connectors; S.native = r.native; S.engine = r.engine; S.crew = crew; if (r.recent) S.feed = r.recent; paint();
  }
  function paint() {
    note.hidden = S.engine === 'hermes'; note.textContent = ''; if (!note.hidden) note.append(h('b', {}, 'Crew engine: '), 'the crew uses these tools only with the Hermes engine. Yours is set to the light built-in one. Change it in Settings (Crew engine).');
    listBox.textContent = ''; if (!S.list.length) listBox.append(h('div', { class: 'cn-empty' }, 'Nothing connected yet. Pick a service below, paste its token, and Orbit tests the connection at once.'));
    for (const c of S.list) listBox.append(card(c));
    nativeBox.textContent = ''; nativeBox.append(h('div', { class: 'cn-card' }, S.native.map(t => h('div', { class: 'cn-trow' }, h('div', { class: 'cn-tname' }, h('b', {}, t.title), h('small', {}, t.description)), levelSelect(t.level, async e => { const r = await bridge.connectors.native(t.name, e.target.value); if (r.ok) { S.native = r.native; paint(); } })))));
    catBox.textContent = ''; for (const c of S.catalog) catBox.append(h('button', { class: 'cn-tile' + (S.list.some(x => x.id === c.id) ? ' off' : ''), type: 'button', onclick: () => { if (!S.list.some(x => x.id === c.id)) openForm(c); } }, h('b', {}, c.name), h('span', {}, c.blurb), S.list.some(x => x.id === c.id) ? h('span', {}, 'Already connected') : null));
    catBox.append(h('button', { class: 'cn-tile', type: 'button', onclick: () => openForm(null) }, h('b', {}, 'Other MCP server'), h('span', {}, 'Any service with an https MCP address and, if it needs one, a token.')));
    paintFeed();
  }
  function paintFeed() {
    feedBox.textContent = ''; const list = S.feed.slice(-30).reverse(); if (!list.length) feedBox.append(h('div', { class: 'cn-empty' }, 'Nothing yet. Every call the crew makes to a connector appears here, and in the Logs.'));
    for (const e of list) feedBox.append(h('div', { class: 'cn-f ' + (e.status || '') }, h('time', {}, clock(e.t)), h('b', {}, e.id || ''), h('span', {}, e.action + (e.status === 'denied' ? ' \u00B7 refused' : e.status === 'error' ? ' \u00B7 failed' : '')), h('small', {}, e.detail || '')));
  }
  function card(c) {
    const n = counts(c.tools);
    const st = h('div', { class: 'cn-status' + (c.lastTest ? (c.lastTest.ok ? ' ok' : ' bad') : '') }, c.lastTest ? (c.lastTest.ok ? `Connected. ${c.tools.length} tools: ${n.free} free, ${n.ask} ask you, ${n.blocked} blocked.` : 'Not connected: ' + (c.lastTest.error || 'no answer')) : 'Not tested yet.');
    const tools = h('div', { class: 'cn-tools', hidden: !S.open.has(c.id) }), agents = h('div', { class: 'cn-agents', hidden: !S.openAgents.has(c.id) });
    for (const t of c.tools) tools.append(h('div', { class: 'cn-trow' }, h('div', { class: 'cn-tname' }, h('b', {}, t.name, ' ', h('i', { class: t.read ? '' : 'w' }, t.read ? 'reads' : 'changes')), t.desc ? h('small', {}, t.desc) : null), levelSelect(t.level, async e => { const r = await bridge.connectors.level(c.id, t.name, e.target.value); if (r.ok) { const i = S.list.findIndex(x => x.id === c.id); S.list[i] = r.connector; paint(); } })));
    const all = c.agents === 'all'; agents.append(h('label', {}, h('input', { type: 'checkbox', checked: all, onchange: e => { bridge.connectors.update(c.id, { agents: e.target.checked ? 'all' : [] }).then(refresh); } }), 'Everyone in the crew'));
    for (const a of S.crew) agents.append(h('label', {}, h('input', { type: 'checkbox', disabled: all, checked: all || (Array.isArray(c.agents) && c.agents.includes(a.id)), onchange: () => { const ids = [...agents.querySelectorAll('input[data-agent]')].filter(i => i.checked).map(i => i.dataset.agent); bridge.connectors.update(c.id, { agents: ids }).then(refresh); }, 'data-agent': a.id }), a.name));
    if (c.catalogId === 'neuralops') {
      const mappings = c.neuralopsIdentities || {}, rows = [{ id: 'commander', name: 'Laila (assistant)' }, ...S.crew.filter(a => a.id !== 'commander')];
      const inputs = [], status = h('div', { class: 'cn-status', role: 'status', 'aria-live': 'polite' }, S.identityNotices.get(c.id) || '');
      agents.append(h('div', { style: 'width:100%' }, h('b', {}, 'Worker identities'), h('p', {}, 'Give each worker a different AI identity registered in NeuralOps. The saved token must belong to their broker, and each identity must name that broker as its delegate. Blank workers cannot use NeuralOps. Test checks tool discovery only; it does not verify these identities.')));
      for (const a of rows) {
        const input = h('input', { class: 'cn-identity', type: 'text', value: mappings[a.id] || '', placeholder: a.id === 'commander' ? 'agent.laila' : 'agent.' + a.id, maxlength: 69, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'NeuralOps identity for ' + a.name });
        input.addEventListener('input', () => { status.className = 'cn-status'; status.textContent = 'Unsaved edits. Save worker identities before verification.'; S.identityNotices.delete(c.id); });
        inputs.push({ actor: a.id, input }); agents.append(h('label', { class: 'cn-row', style: 'width:100%' }, a.name, input));
      }
      const save = h('button', { class: 'cn-btn', type: 'button' }, 'Save worker identities');
      save.onclick = async () => {
        const identities = {}; for (const row of inputs) identities[row.actor] = row.input.value.trim();
        save.disabled = true; status.className = 'cn-status'; status.textContent = 'Saving identities...';
        try { const r = await bridge.connectors.update(c.id, { neuralopsIdentities: identities }); if (!r.ok) { status.className = 'cn-status bad'; status.textContent = r.error; return; } S.identityNotices.set(c.id, 'Mappings saved. Registration and delegation still need verification.'); await refresh(); }
        catch { status.className = 'cn-status bad'; status.textContent = 'The identities could not be saved. Try again.'; }
        finally { save.disabled = false; }
      };
      const verify = h('button', { class: 'cn-btn', type: 'button' }, 'Verify worker identities');
      verify.onclick = async () => {
        if (inputs.some(row => row.input.value.trim() !== (mappings[row.actor] || ''))) { status.className = 'cn-status bad'; status.textContent = 'Save worker identities before verifying. Unsaved names are not checked.'; return; }
        verify.disabled = true; status.className = 'cn-status'; status.textContent = 'Checking saved broker and worker identities...';
        try {
          const r = await bridge.connectors.verifyIdentities(c.id);
          if (!r.ok) { status.className = 'cn-status bad'; status.textContent = r.error || 'Verification unavailable.'; return; }
          const v = r.verification, labels = { verified: 'verified', no_mapping: 'no saved identity', access_disabled: 'connector access disabled', authentication_refused: 'token refused or expired', delegation_refused: 'identity or delegation refused', invalid_response: 'service did not return verifiable identity evidence', unexpected_identity: 'service returned a different identity', revoked_or_unknown: 'revoked or revocation status unavailable', broker_required: 'saved token does not belong to a broker', delegate_mismatch: 'delegate does not match this broker', workspace_mismatch: 'workspace does not match this broker', unavailable: 'service unavailable', deadline: 'verification timed out', stale: 'configuration changed; verify again', not_checked: 'not checked' };
          status.className = 'cn-status' + (v.allPassed ? ' ok' : ' bad'); status.textContent = '';
          status.append(h('div', {}, v.stale ? 'Configuration changed during verification; results cannot be used.' : 'Read-only check at ' + new Date(v.checkedAt).toLocaleTimeString() + '. This does not grant permission or verify a job.'));
          status.append(h('div', {}, 'Broker: ' + (labels[v.broker.reason] || 'unverified') + (v.broker.id ? ' (' + v.broker.id + ')' : '')));
          for (const row of v.workers) status.append(h('div', {}, (rows.find(a => a.id === row.actor)?.name || row.actor) + ': ' + (row.identity || '(blank)') + ' — ' + (labels[row.reason] || 'unverified')));
          if (!v.workers.length) status.append(h('div', {}, 'Workers were not checked because broker verification failed.'));
        } catch { status.className = 'cn-status bad'; status.textContent = 'Verification unavailable. No identities or permissions were changed.'; }
        finally { verify.disabled = false; }
      };
      agents.append(save, verify, status);
    }
    const roots = c.native === 'files' ? h('div', { class: 'cn-agents cn-roots' }, h('b', { style: 'font:600 12px var(--m);color:var(--dim);width:100%' }, 'Folders the crew may use'), c.roots.map(r => h('div', { class: 'cn-root' }, h('span', {}, r), c.roots.length > 1 ? h('button', { class: 'cn-btn danger', type: 'button', title: 'Stop using this folder', onclick: async () => { const x = await bridge.connectors.roots(c.id, c.roots.filter(y => y !== r)); if (!x.ok) alert(x.error); refresh(); } }, 'Remove') : null)),
      h('button', { class: 'cn-btn', type: 'button', onclick: async () => { const pk = await bridge.connectors.pickFolder(); if (!pk.ok || !pk.path) return; const x = await bridge.connectors.roots(c.id, [...c.roots, pk.path]); if (!x.ok) alert(x.error); refresh(); } }, 'Add a folder\u2026')) : null;
    const auto = c.catalogId === 'neuralops' || /127\.0\.0\.1:3031\/mcp/.test(String(c.url || '')); const modeSel = h('select', { class: 'cn-btn', 'aria-label': 'Access', style: auto ? 'display:none' : '', onchange: async e => { const m = e.target.value; if (m === 'read-write' && !confirm(`Let the crew TRY to change things in ${c.name}?\n\nEvery change will ask you first, each time. Reading stays free.\n\nRead only blocks all changes.`)) { e.target.value = c.mode; return; } await bridge.connectors.update(c.id, { mode: m }); await runTest(c, st); } },
      h('option', { value: 'read-only', selected: c.mode === 'read-only' }, 'Read only'), h('option', { value: 'read-write', selected: c.mode === 'read-write' }, 'Read, ask before changes'));
    return h('div', { class: 'cn-card' },
      h('div', { class: 'cn-top' }, h('i', { class: 'cn-dot ' + (c.lastTest ? (c.lastTest.ok ? 'ok' : 'bad') : '') }), h('b', {}, c.name), h('span', { class: 'cn-badge ' + (c.mode === 'read-write' ? 'rw' : 'ro') }, auto ? 'auto, authority tools ask you' : (c.mode === 'read-write' ? 'read, ask before changes' : 'read only')), h('span', { class: 'cn-host' }, c.native ? 'Orbit\u2019s own tools, on this computer' : host(c.url)),
        h('label', { class: 'cn-row', style: 'font:12px var(--m);color:var(--dim)' }, h('input', { type: 'checkbox', checked: c.enabled, onchange: e => bridge.connectors.update(c.id, { enabled: e.target.checked }).then(refresh) }), 'On')),
      st,
      h('div', { class: 'cn-row' }, modeSel, h('button', { class: 'cn-btn', type: 'button', onclick: () => runTest(c, st) }, 'Test'), h('button', { class: 'cn-btn', type: 'button', onclick: () => { S.open.has(c.id) ? S.open.delete(c.id) : S.open.add(c.id); tools.hidden = !S.open.has(c.id); } }, 'Tools'),
        h('button', { class: 'cn-btn', type: 'button', onclick: () => { S.openAgents.has(c.id) ? S.openAgents.delete(c.id) : S.openAgents.add(c.id); agents.hidden = !S.openAgents.has(c.id); } }, 'Who can use it'), c.native ? null : h('button', { class: 'cn-btn', type: 'button', onclick: () => changeToken(c) }, 'Change token'),
        h('button', { class: 'cn-btn danger', type: 'button', onclick: async () => { if (confirm(`Remove ${c.name}? Its token is deleted from this computer.`)) { await bridge.connectors.remove(c.id); refresh(); } } }, 'Remove')),
      roots, tools, agents);
  }
  async function runTest(c, st) { st.className = 'cn-status'; st.textContent = 'Testing the connection\u2026'; const r = await bridge.connectors.test(c.id); if (!r.ok) { st.className = 'cn-status bad'; st.textContent = r.error || 'The test could not run.'; return; } await refresh(); }
  function changeToken(c) {
    const tok = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' }), out = h('div', { class: 'cn-status' }), go = h('button', { class: 'cn-btn go', type: 'button' }, 'Save and test');
    go.onclick = async () => { go.disabled = true; out.className = 'cn-status'; out.textContent = 'Saving and testing\u2026'; const r = await bridge.connectors.token(c.id, tok.value); tok.value = ''; go.disabled = false; if (!r.ok) { out.className = 'cn-status bad'; out.textContent = r.error; return; } close(); refresh(); };
    form.textContent = ''; form.append(h('div', { class: 'cn-box' }, h('h3', {}, 'New token for ' + c.name), h('label', { class: 'f' }, 'Token', tok, h('small', {}, 'It replaces the old one, which is deleted. Stored on this computer only.')), out, h('div', { class: 'cn-row' }, go, h('button', { class: 'cn-btn', type: 'button', onclick: () => close() }, 'Cancel')))); form.classList.add('on'); tok.focus();
  }

  /* ---------- the add form ---------- */
  function openForm(cat) {
    const custom = !cat, native = !!(cat && cat.native), fields = {}, out = h('div', { class: 'cn-status' }), warn = h('div', { class: 'cn-warn', hidden: !(cat && cat.warn) }, cat ? cat.warn : ''), inputs = [];
    if (custom) { fields.name = h('input', { type: 'text', maxlength: 24, placeholder: 'for example: docs' }); fields.url = h('input', { type: 'text', placeholder: 'https://mcp.example.com/mcp', spellcheck: 'false' }); inputs.push(h('label', { class: 'f' }, 'Name', fields.name), h('label', { class: 'f' }, 'MCP address', fields.url)); }
    else if (native) { fields.folders = h('textarea', { rows: 3, spellcheck: 'false', placeholder: 'One folder per line, for example C:\\Users\\you\\Documents\\projects  (empty = only Orbit\u2019s workspace)' }); const pick = h('button', { class: 'cn-btn', type: 'button', style: 'align-self:flex-start', onclick: async () => { const pk = await bridge.connectors.pickFolder(); if (pk.ok && pk.path) fields.folders.value = (fields.folders.value.trim() ? fields.folders.value.trim() + '\n' : '') + pk.path; } }, 'Choose a folder\u2026'); inputs.push(h('label', { class: 'f' }, 'Folders the crew may use', fields.folders, h('small', {}, 'Only these folders. Not a whole drive, not system folders, not your user folder itself.')), pick); }
    else for (const o of cat.options) { fields[o.key] = h('input', { type: 'text', spellcheck: 'false' }); inputs.push(h('label', { class: 'f' }, o.label + (o.required ? '' : ' (optional)'), fields[o.key], h('small', {}, o.help || ''))); }
    fields.token = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: custom ? 'Token (leave empty if the server needs none)' : '' });
    if (!native) inputs.push(h('label', { class: 'f' }, custom ? 'Token' : cat.tokenLabel, fields.token, h('small', {}, custom ? 'Sent to that server as "Authorization: Bearer ...". Stored on this computer only; the crew never sees it.' : cat.tokenHelp)));
    const ro = h('input', { type: 'radio', name: 'cn-mode', value: 'read-only', checked: true }), rw = h('input', { type: 'radio', name: 'cn-mode', value: 'read-write' });
    const mode = h('div', { class: 'cn-mode' }, h('label', {}, ro, h('span', {}, h('b', {}, 'Read only (recommended)'), h('small', {}, 'The crew can look things up. Every change is blocked.'))), h('label', {}, rw, h('span', {}, h('b', {}, 'Read, and ask before changes'), h('small', {}, 'The crew can also try to create, edit or delete. Each change asks you first, every time.'))));
    const go = h('button', { class: 'cn-btn go', type: 'button' }, 'Connect and test'), cancel = h('button', { class: 'cn-btn', type: 'button', onclick: () => close() }, 'Cancel');
    go.onclick = async () => {
      go.disabled = true; out.className = 'cn-status'; out.textContent = 'Connecting and testing\u2026 (up to a minute)';
      const spec = { catalogId: cat ? cat.id : null, name: custom ? fields.name.value : undefined, url: custom ? fields.url.value : undefined, token: fields.token.value, mode: rw.checked ? 'read-write' : 'read-only', options: {} };
      if (native) spec.folders = fields.folders.value; else if (cat) for (const o of cat.options) spec.options[o.key] = fields[o.key].value;
      const r = await bridge.connectors.add(spec); fields.token.value = ''; go.disabled = false;
      if (!r.ok) { out.className = 'cn-status bad'; out.textContent = r.error || 'That did not work.'; return; }
      const t = r.test, n = counts(r.connector.tools); if (t.ok) { out.className = 'cn-status ok'; out.textContent = `Connected. ${t.count} tools: ${n.free} free, ${n.ask} ask you, ${n.blocked} blocked.`; setTimeout(close, 1500); } else { out.className = 'cn-status bad'; out.textContent = 'Saved, but the test failed: ' + (t.error || 'no answer') + ' Check the token, then press Test on the card.'; }
      refresh();
    };
    form.textContent = ''; form.append(h('div', { class: 'cn-box' }, h('h3', {}, custom ? 'Add an MCP server' : 'Connect ' + cat.name), warn, ...inputs, ...(cat && cat.id === 'neuralops' ? [] : [mode]), out, h('div', { class: 'cn-row' }, go, cancel))); form.classList.add('on');
    const first = form.querySelector('input'); if (first) first.focus();
  }
  const close = () => { form.classList.remove('on'); form.textContent = ''; };
  form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  bridge.onBus(({ type, payload }) => { if (type === 'connector:activity') { S.feed.push(payload); if (S.feed.length > 80) S.feed.shift(); if (document.body.dataset.view === 'connectors') paintFeed(); } });
  window.__connectors = { enter: refresh, leave: close, state: () => S };
})();

