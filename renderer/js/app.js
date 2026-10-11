/* Orbit: wires the world, the voice, the crew and the permission prompts together. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v); }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const pad = n => String(n).padStart(2, '0');
  const errText = e => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  let cfg, scene, presence, town, live, agentsList = [], vstate = 'offline', muted = false, started = false;
  const partial = {}; const chips = new Map(); const lv = { mic: 0, out: 0 };
  const t0 = Date.now();

  // ---------- helpers ----------
  const STATUS = { offline: 'Standing by', connecting: 'Connecting', listening: 'Listening', speaking: 'Speaking', working: 'Working', thinking: 'Thinking' };
  function paintState() {
    const s = vstate === 'listening' && muted ? 'muted' : vstate;
    $('#hud-status').textContent = s === 'muted' ? 'Mic muted' : (STATUS[s] || 'Standing by');
    presence.setState(vstate === 'offline' ? (cfg.apiKey ? 'idle' : 'offline') : (muted && vstate === 'listening' ? 'idle' : vstate));
    town && town.setCommander({ state: vstate, name: cfg.aiName });
    const on = vstate !== 'offline'; $('#mic').setAttribute('aria-pressed', String(on && !muted)); $('#mic').classList.toggle('live', on && !muted); $('#mic').classList.toggle('muted', on && muted);
    $('#mic').setAttribute('aria-label', !on ? 'Wake voice' : muted ? 'Unmute microphone' : 'Mute microphone');
    const pill = $('#pill-net'); pill.className = 'pill ' + (on ? (vstate === 'connecting' ? 'warn' : 'ok') : '');
    pill.querySelector('span').textContent = on ? (vstate === 'connecting' ? 'Connecting' : 'Voice live') : 'Voice offline';
    $('#end-voice').hidden = !on;
    $('#comms-note').textContent = !cfg.apiKey ? 'Uplink offline. Add a key in Settings' : on ? (muted ? 'Mic muted' : 'Listening. Just talk') : 'Press the mic or Ctrl+Alt+J to talk';
  }
  function cue(text) { const c = $('#cue'); c.textContent = text; c.classList.add('on'); clearTimeout(cue.t); cue.t = setTimeout(() => c.classList.remove('on'), 7000); }
  function addMsg(role, text, extra = {}) {
    const log = $('#log'), near = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
    const who = role === 'user' ? (cfg.userName || 'You') : role === 'ai' ? cfg.aiName : '';
    const el = h('div', { class: `msg ${role}` + (extra.partial ? ' partial' : '') }, who ? h('small', {}, who) : null, h('p', {}, text));
    if (window.__chat) __chat.decorate(el, role, text, extra);
    log.append(el); if (near || role === 'user') log.scrollTop = log.scrollHeight; return el;
  }
  function logActivity(text, cls = '') {
    const ul = $('#activity'); const d = new Date(); ul.prepend(h('li', { class: cls }, h('time', {}, `${pad(d.getHours())}:${pad(d.getMinutes())}`), h('span', {}, text)));
    while (ul.children.length > 40) ul.lastChild.remove();
  }

  // ---------- voice ----------
  function makeLive() {
    return new LiveClient({
      onState: s => { vstate = s; paintState(); },
      onTranscript: (role, text, final) => {
        if (!text) return; if (window.__chat) __chat.heard(role);
        if (!partial[role]) partial[role] = addMsg(role, window.__chat ? __chat.script(text) : text, { partial: true });
        partial[role].querySelector('p').textContent = window.__chat ? __chat.script(text) : text;
        if (final) { partial[role].classList.remove('partial'); if (window.__chat) __chat.finalize(partial[role], role); partial[role] = null; }
      },
      onLevel: p => { if (window.__chat) __chat.level(p, vstate); if ('mic' in p) lv.mic = p.mic; if ('out' in p) lv.out = p.out; presence.setLevel(vstate === 'speaking' ? lv.out : lv.mic); town && town.setCommander({ level: lv.out }); $('#micmeter').style.transform = `scaleY(${Math.min(1, lv.mic * 1.4).toFixed(2)})`; },
      onError: m => { addMsg('sys', m); cue(m); paintState(); },
      onNotice: m => addMsg('sys', m)
    });
  }
  function startVoice(opts) {
    if (!cfg.apiKey) { addMsg('sys', 'Voice needs your Gemini key. Open Settings to add it.'); return; }
    muted = false; SFX.chime(); live.start(opts);
  }
  function wake() {
    if (!started) return;
    if (!live.want) startVoice({ greet: `[SYSTEM] The user (${whoFull()}) just woke you. Say a very short hello.` });
    else if (muted) { muted = false; live.setMuted(false); paintState(); }
  }

  // ---------- text ----------
  let pendingAttach = null;
  async function sendText(text) {
    text = text.trim();
    if (pendingAttach) {
      text = (text || 'Please take a look at this file.') + `

[Attached file: ${pendingAttach}]`;
      pendingAttach = null; const nameEl = $('#attach-name'); if (nameEl) { nameEl.textContent = ''; nameEl.hidden = true; }
    }
    if (!text) return;
    addMsg('user', text); const sent = window.__chat ? __chat.outgoing(text) : text;   // a note is added in front when you tag someone
    if (live.connected) { live.sendText(sent); return; }
    if (!cfg.apiKey) { addMsg('ai', `My uplink is offline, ${who()}. Add your Gemini key in Settings.`); return; }
    presence.setState('thinking'); $('#hud-status').textContent = 'Thinking'; $('#send').disabled = true;
    const r = await bridge.chat.send(sent); addMsg('ai', r.text); $('#send').disabled = false; paintState();
  }
  async function onReport({ text, agent, ok, secs }) {
    const took = secs != null && window.__chat ? ` in ${__chat.fmtMs(secs * 1000)}` : '';
    logActivity(`${agent} ${ok ? 'finished a job' : 'hit a problem'}${took}`, ok ? 'ok' : 'bad');
    if (live.connected) { live.sendText(text); return; }
    addMsg('sys', `${agent} ${ok ? 'finished a job' : 'hit a problem'}${took}.`);
    if (!cfg.apiKey) return;
    presence.setState('thinking'); const r = await bridge.chat.send(text); addMsg('ai', r.text); paintState();
  }

  // ---------- tools, crew, bus ----------
  const NICE = { web_search: 'Searching the web', browser_open: 'Opening a web page', browser_read: 'Reading a web page', browser_click: 'Clicking on a web page', browser_type: 'Typing on a web page', browser_select: 'Using a web page', browser_press: 'Using a web page', browser_scroll: 'Scrolling a web page', browser_nav: 'Using a web page', browser_tabs: 'Using browser tabs', browser_wait: 'Waiting for a web page', read_file: 'Reading a file', list_dir: 'Looking in a folder', write_file: 'Writing a file', run_shell: 'Running a command', open_url: 'Opening a page', open_app: 'Opening an app', create_agent: 'Creating an agent', assign_task: 'Assigning a task', list_agents: 'Checking the crew', get_system_info: 'Checking the system', add_skill: 'Adding a skill', remember: 'Saving a memory', list_jobs: 'Checking jobs', get_job: 'Checking a job' };
  function argLine(a) { const v = a.query || a.command || a.path || a.url || a.name || a.task || a.agent || a.note || ''; return String(v).slice(0, 70); }
  function onTool(ev) {
    const mine = ev.actor === 'commander', id = ev.callId;
    if (ev.status === 'start') {
      logActivity(`${mine ? '' : ev.actorName + ': '}${NICE[ev.name] || ev.name}`);
      if (mine) { const el = h('div', { class: 'chip-tool run' }, h('i'), h('b', {}, ev.name), h('span', {}, argLine(ev.args)), h('em', {}, '…')); chips.set(id, el); $('#log').append(el); $('#log').scrollTop = $('#log').scrollHeight; }
      return;
    }
    const el = chips.get(id);
    if (el && ev.name === 'decision' && ev.args && ev.args.route) { const sp = el.querySelector('span'); if (sp) sp.textContent = ['route: ' + ev.args.route, ev.args.urgency != null ? 'urgency: ' + ev.args.urgency : '', ev.args.by ? 'by: ' + ev.args.by : '', ev.args.model || ''].filter(Boolean).join(' \u00B7 '); }
    if (el) { el.className = 'chip-tool ' + (ev.status === 'done' ? 'ok' : 'bad'); el.querySelector('em').textContent = ev.status === 'done' ? (ev.ms / 1000).toFixed(1) + 's' : ev.status === 'denied' ? 'denied' : 'failed'; if (ev.reason) el.title = ev.reason; }
    if (ev.status !== 'done') logActivity(`${ev.actorName}: ${NICE[ev.name] || ev.name} ${ev.status === 'denied' ? 'was denied' : 'failed'}${ev.reason ? ` (${ev.reason})` : ''}`, 'bad');
  }
  const who = () => cfg.userTitle || cfg.userName || 'there', whoFull = () => [cfg.userTitle, cfg.userName].filter(Boolean).join(' ') || 'there';   // how she greets you (a title is optional)
  window.__refreshCfg = async () => { cfg = await bridge.config.get(); };
  async function refreshAgents() { agentsList = await bridge.agents.list(); town.setAgents(agentsList); }
  function bindBus() {
    bridge.onBus(({ type, payload: p }) => {
      if (type === 'tool') onTool(p);
      else if (type === 'agent:state') { town && town.setState(p.id, p); if (town && town.selected === p.id) showInspector(p.id); }
      else if (type === 'agent:created') { refreshAgents(); SFX.chime(); logActivity(`${p.name} joined the crew (${p.role})`, 'ok'); }
      else if (type === 'agent:updated') { if (town && town.selected === p.id) showInspector(p.id); }
      else if (type === 'job:created') logActivity(`${p.agent.name} received a job`);
      else if (type === 'job:progress') { if (p.status === 'running') logActivity(`${p.agent.name}: ${p.tool}${p.label ? ' · ' + String(p.label).slice(0, 46) : ''}`); }
      else if (type === 'job:done') { if (town && town.selected === p.agent.id) showInspector(p.agent.id); }
      else if (type === 'report') onReport(p);
      else if (type === 'permission') showPermission(p);
      else if (type === 'permission:expired') document.querySelector(`[data-perm="${p.id}"]`)?.remove();
      else if (type === 'comms:status') { window.__commsStatus && window.__commsStatus(p); }
      else if (type === 'comms:event') logActivity(p.text, 'bad');
      else if (type === 'anomaly') { logActivity('anomaly \u00B7 ' + p.text, 'bad'); try { const el = h('div', { class: 'chip-tool bad' }, h('i'), h('b', {}, p.stopped ? 'stopped' : 'anomaly'), h('span', {}, String(p.text).slice(0, 160)), h('em', {}, '')); $('#log').append(el); $('#log').scrollTop = $('#log').scrollHeight; } catch { /* the chat chip is optional */ } }
      else if (type === 'tag') { const t = p.fromName + ' \u2192 ' + p.toName + ' \u00B7 ' + p.kind + ': ' + String(p.text).slice(0, 140); logActivity(t, 'ok'); try { const el = h('div', { class: 'chip-tool ok' }, h('i'), h('b', {}, 'note'), h('span', {}, t), h('em', {}, '')); $('#log').append(el); $('#log').scrollTop = $('#log').scrollHeight; } catch { /* the chat chip is optional */ } }
      else if (type === 'wake') wake();
    });
  }

  async function showInspector(id) {
    const box = $('#inspect'); if (!id) { box.hidden = true; return; }
    const r = await bridge.agents.inspect(id); if (!r) { box.hidden = true; return; }
    const st = agentsList.find(a => a.id === id) || {};
    const engineRow = id === 'jarvis' ? null : (() => {
      const eng = h('select', {}, [['', 'Crew default'], ['builtin', 'Built-in'], ['hermes', 'Hermes Agent'], ['opencode', 'OpenCode']].map(([v, t]) => h('option', { value: v, selected: v === (r.agent.engine || '') }, t)));
      const prov = h('input', { value: r.agent.workerProvider || '', placeholder: 'gemini / openrouter / anthropic / openai / custom' });
      const model = h('input', { value: r.agent.workerModel || '', placeholder: 'blank = crew model' });
      const key = h('input', { type: 'password', autocomplete: 'off', value: r.agent.workerApiKey || '', placeholder: 'blank = crew key' });
      const base = h('input', { value: r.agent.workerBaseUrl || '', placeholder: 'https://.../v1 (custom only)' });
      const out = h('small', {});
      return h('div', { class: 'in-engine' }, h('small', {}, `${r.agent.name}'s own engine (blank = use the crew default from Settings)`),
        h('div', { class: 'set-grid' },
          h('label', { class: 'field' }, h('span', {}, 'Engine'), eng),
          h('label', { class: 'field' }, h('span', {}, 'Provider'), prov),
          h('label', { class: 'field' }, h('span', {}, 'Model'), model),
          h('label', { class: 'field' }, h('span', {}, 'API key'), key),
          h('label', { class: 'field' }, h('span', {}, 'Base URL'), base)),
        h('div', {}, h('button', { class: 'mini', onclick: async () => {
          out.textContent = 'Saving…';
          try { await bridge.agents.update(id, { engine: eng.value, workerProvider: prov.value.trim(), workerModel: model.value.trim(), workerApiKey: key.value.trim(), workerBaseUrl: base.value.trim() }); out.textContent = 'Saved.'; }
          catch (e) { out.textContent = errText(e); }
        } }, 'Save engine'), out));
    })();
    box.hidden = false; box.replaceChildren(...[
      h('div', { class: 'in-head' }, h('b', {}, r.agent.name), h('span', {}, r.agent.role), h('button', { class: 'mini', onclick: () => bridge.showInFolder(r.folder) }, 'Open folder'), h('button', { class: 'x', 'aria-label': 'Close', onclick: () => { town.selected = null; box.hidden = true; } }, '×')),
      h('div', { class: 'in-grid' },
        h('div', {}, h('small', {}, 'Brain'), h('p', {}, r.soul.replace(/^#.*\n+/, '').split('\n').filter(Boolean).slice(0, 3).join(' ').slice(0, 170) || '—')),
        h('div', {}, h('small', {}, `Skills (${r.skills.length})`), h('p', {}, r.skills.join(', ') || 'None yet')),
        h('div', {}, h('small', {}, 'Jobs'), h('p', {}, r.jobs.length ? r.jobs.slice(0, 2).map(j => `${j.status}: ${j.task.slice(0, 48)}`).join(' · ') : (st.state === 'working' ? st.task : 'None yet')))),
      engineRow
    ].filter(Boolean));
  }

  // ---------- modals ----------
  const modals = () => $('#modals');
  function modal(title, body, actions, opts = {}) {
    const back = h('div', { class: 'modal-back', ...(opts.attrs || {}) }), box = h('div', { class: 'modal' + (opts.cls ? ' ' + opts.cls : ''), role: opts.role || 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, title), body, h('div', { class: 'modal-actions' }, actions));
    back.append(box); modals().append(back); return { back, close: () => back.remove() };
  }
  function showPermission(p) {
    SFX.alert();
    const answer = d => { bridge.permission.answer(p.id, d); m.close(); };
    const deny = h('button', { class: 'btn ghost', onclick: () => answer('deny') }, 'Deny');
    const body = h('div', {}, h('p', { class: 'perm-who' }, `${p.actorName} wants to:`), h('p', { class: 'perm-what' }, p.title), h('pre', { class: 'perm-detail' }, p.detail || ''));
    const m = modal('Permission needed', body, [deny, h('button', { class: 'btn primary', onclick: () => answer('once') }, 'Allow once'), p.allowSession ? h('button', { class: 'btn primary alt', onclick: () => answer('session') }, (p.sessionLabel || 'Allow this folder for the session')) : null], { role: 'alertdialog', cls: 'perm', attrs: { 'data-perm': p.id } });
    m.back.addEventListener('keydown', e => { if (e.key === 'Escape') answer('deny'); }); deny.focus();
  }
  async function openCrewConfig() {
    let token = null, revision = null, unresolved = [], generation = 0;
    const text = h('textarea', { rows: 16, spellcheck: 'false', 'aria-label': 'Crew YAML', maxlength: 65536 });
    const status = h('p', { role: 'status' }), diff = h('pre', { class: 'perm-detail', 'aria-label': 'Configuration diff' });
    const history = h('pre', { class: 'perm-detail', 'aria-label': 'Incomplete import history' });
    const recoverySummary = h('div', { 'aria-label': 'Import recovery summary' });
    const inspected = h('input', { type: 'checkbox' });
    const ackLabel = h('label', { class: 'check inline', hidden: true }, inspected, h('span', {}, 'I inspected the current configuration and incomplete import history'));
    const apply = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
      const selected = token; invalidate(false); text.disabled = true;
      try {
        const r = await bridge.crewConfig.apply(selected); if (!r.ok) throw new Error(r.error);
        await refreshAgents(); await reload(); status.textContent = `${r.operation === 'rollback' ? 'Rollback applied' : 'Applied'} and verified ${r.changed} field change(s).`;
      } catch (e) { status.textContent = errText(e); }
      finally { text.disabled = false; }
    } }, 'Apply reviewed changes');
    const ack = h('button', { class: 'btn ghost', hidden: true, disabled: true, onclick: async () => {
      ack.disabled = true;
      try {
        const r = await bridge.crewConfig.acknowledge({ revision, receiptIds: unresolved.map(e => e.id) });
        if (!r.ok) throw new Error(r.error); await reload(); status.textContent = 'Inspection recorded. Preview a new import to make further changes.';
      } catch (e) { status.textContent = errText(e); }
    } }, 'Record inspection');
    function invalidate(cancel = true) { const old = token; generation++; token = null; apply.disabled = true; apply.textContent = 'Apply reviewed changes'; diff.textContent = ''; if (old && cancel !== false) bridge.crewConfig.cancel(old).catch(() => {}); }
    text.addEventListener('input', invalidate);
    inspected.addEventListener('change', () => { ack.disabled = !inspected.checked; });
    async function reload() {
      invalidate(); const n = generation;
      const r = await bridge.crewConfig.export(); if (!r.ok) throw new Error(r.error);
      if (n !== generation) return;
      text.value = r.text; revision = r.revision; unresolved = r.unresolved;
      history.textContent = unresolved.length ? JSON.stringify(unresolved, null, 2) : '';
      const labels = { matches_requested: 'Requested settings match', unchanged: 'Unchanged', partial: 'Partially changed', drifted: 'Configuration drift', missing: 'Worker missing', unknown: 'Unknown' };
      recoverySummary.replaceChildren(...unresolved.flatMap(e => {
        const r = e.reconciliation;
        return [h('h3', {}, 'Interrupted import reconciliation'),
          h('p', {}, `Base revision: ${r.baseRevision || 'Unavailable'}`),
          h('p', {}, `Current revision: ${r.currentRevision}`),
          h('p', {}, `Requested document: ${r.requestedDocumentHash || 'Unavailable'}`),
          h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Worker'), h('th', {}, 'Persisted configuration'), h('th', {}, 'Progress recorded'))),
            h('tbody', {}, r.workers.map(w => h('tr', {}, h('td', {}, w.id), h('td', {}, labels[w.status] || 'Unknown'), h('td', {}, w.progressRecorded ? 'Yes' : 'No'))))),
          r.legacyIntentWithoutWorkerHashes ? h('p', {}, 'Older intent lacks per-worker hashes. Worker outcomes cannot be inferred.') : null,
          h('p', {}, 'Full-state rollback safety has not been established. Automatic rollback is unavailable. Public settings may be reversed only after reviewing the diff.'),
          h('button', { class: 'btn ghost', disabled: unresolved.length !== 1 || e.operation === 'rollback', onclick: async () => {
            invalidate(); const n = generation;
            try {
              const result = await bridge.crewConfig.previewRollback({ revision, receiptId: e.id });
              if (!result.ok) throw new Error(result.error);
              if (n !== generation) { bridge.crewConfig.cancel(result.token).catch(() => {}); return; }
              token = result.token; diff.textContent = result.changes.length ? JSON.stringify(result.changes, null, 2) : 'No settings need rollback. Record inspection instead.';
              apply.disabled = !result.changes.length; apply.textContent = 'Apply reviewed rollback';
              status.textContent = 'Review this reverse diff. Only public worker settings and Library assignments will be restored; drift and active jobs block rollback.';
            } catch (error) { if (n === generation) status.textContent = errText(error); }
          } }, 'Preview settings rollback')].filter(Boolean);
      }));
      ackLabel.hidden = ack.hidden = !unresolved.length; inspected.checked = false; ack.disabled = true;
      status.textContent = unresolved.length ? 'Incomplete import: inspect the current export and history. No automatic replay occurred.' : 'Current stored configuration. Edit or load YAML, then preview the changes.';
    }
    const file = h('input', { type: 'file', accept: '.yaml,.yml', 'aria-label': 'Load crew YAML' });
    file.addEventListener('change', async () => {
      invalidate(); const n = generation, f = file.files[0]; if (!f) return;
      if (f.size > 65536) { status.textContent = 'File is larger than 64 KiB.'; return; }
      try { const value = await f.text(); if (n === generation) { text.value = value; status.textContent = 'File loaded for preview. Nothing has been applied.'; } }
      catch { status.textContent = 'File could not be read.'; }
    });
    const body = h('div', { class: 'crew-config-body' }, h('p', {}, 'Versioned configuration for existing workers: engine, provider, model, context and shared Library assignments. Create workers through Add crew. Credentials, permissions, jobs and runtime status stay outside YAML.'),
      h('label', { class: 'field' }, h('span', {}, 'Load YAML file'), file), text, status, diff, recoverySummary, history, ackLabel, ack);
    const m = modal('Crew configuration', body, [h('button', { class: 'btn ghost', onclick: async () => { try { await reload(); } catch (e) { status.textContent = errText(e); } } }, 'Reload from Orbit'),
      h('button', { class: 'btn ghost', onclick: async () => {
        try {
          const r = await bridge.crewConfig.export(); if (!r.ok) throw new Error(r.error);
          const url = URL.createObjectURL(new Blob([r.text], { type: 'application/yaml' }));
          const a = h('a', { href: url, download: 'orbit-crew.yaml' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) { status.textContent = errText(e); }
      } }, 'Export stored YAML'), h('button', { class: 'btn ghost', onclick: async () => {
        invalidate(); const n = generation, value = text.value;
        try {
          const r = await bridge.crewConfig.preview(value); if (!r.ok) throw new Error(r.error);
          if (n !== generation || value !== text.value) return;
          token = r.token; diff.textContent = r.changes.length ? JSON.stringify(r.changes, null, 2) : 'No changes.';
          apply.disabled = !r.changes.length; status.textContent = 'Preview only. Apply explicitly within five minutes; queued or running jobs block changes.';
        } catch (e) { if (n === generation) status.textContent = errText(e); }
      } }, 'Preview changes'), apply, h('button', { class: 'btn ghost', onclick: () => { invalidate(); m.close(); } }, 'Close')], { cls: 'settings crew-config' });
    try { await reload(); } catch (e) { status.textContent = errText(e); }
  }
  async function openStorageGuardian() {
    let token=null; const selected=new Set(),status=h('p',{role:'status'}),rows=h('div'),summary=h('p');
    const take=async promise=>{const r=await promise;if(!r.ok)throw Error(r.error);return r.result;};
    const invalidate=async()=>{if(token){const old=token;token=null;await take(bridge.storage.cancel(old));}apply.disabled=true;};
    const reload=async()=>{await invalidate();selected.clear();const r=await take(bridge.storage.inspect());summary.textContent=`Native recovery protected for ${r.keepDays} days. No automatic deletion. ${r.rows.length} recovery records. Home ${r.usage.logicalBytes} logical bytes; free disk ${r.usage.freeBytes??'unknown'} bytes. Categories: ${Object.entries(r.usage.totals).map(([k,v])=>k+': '+v.bytes).join(', ')}. Coverage ${r.usage.coverage.complete?'complete':'incomplete'}.`;
      rows.replaceChildren(...r.rows.map(row=>{const input=h('input',{type:'checkbox',disabled:!row.eligible,'aria-label':'Select recovery '+row.id});input.addEventListener('change',async()=>{try{await invalidate();input.checked?selected.add(row.id):selected.delete(row.id);}catch(e){status.textContent=errText(e);}});
        const pin=h('button',{class:'btn ghost',disabled:row.interruptedRelease,onclick:async()=>{try{await take(bridge.storage.pin(row.id,!row.pinned));await reload();}catch(e){status.textContent=errText(e);}}},row.pinned?'Unpin recovery':'Pin recovery');
        return h('div',{},h('label',{},input,`${row.actor} / ${row.id}: ${row.status}; ${row.eligible?(row.bytes+' logical bytes eligible'):row.blocked}`),pin); }));};
    const apply=h('button',{class:'btn danger',disabled:true,onclick:async()=>{try{const current=token;token=null;apply.disabled=true;const r=await take(bridge.storage.apply(current));await reload();status.textContent=`Removed ${r.removedLogicalBytes} logical bytes; measured net Home reduction ${r.netManagedLogicalReclaimedBytes} bytes (includes receipts). Allocated reduction ${r.allocatedReclaimedBytes??'unknown'} bytes. Shared free-disk change ${r.observedFreeBytesDelta} bytes is not attributed savings.`;}catch(e){status.textContent=errText(e);}}},'Release previewed native recovery');
    const preview=h('button',{class:'btn ghost',onclick:async()=>{try{await invalidate();const r=await take(bridge.storage.preview([...selected]));token=r.token;status.textContent=r.warning+' Selected: '+r.jobs.map(j=>j.actor+'/'+j.id+' ('+j.bytes+' bytes)').join(', ');apply.disabled=false;}catch(e){status.textContent=errText(e);}}},'Preview selected release');
    const close=async()=>{try{await invalidate();m.close();}catch(e){status.textContent=errText(e);}};
    const m=modal('Storage Guardian',h('div',{},summary,h('p',{},'Active, interrupted, failed, pinned and linked recovery stays protected. An interrupted release needs fresh inspection. Docker images/cache are not removed.'),rows,status),[h('button',{class:'btn ghost',onclick:async()=>{try{await reload();}catch(e){status.textContent=errText(e);}}},'Refresh'),preview,apply,h('button',{class:'btn ghost',onclick:close},'Cancel')]);
    m.back.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
    try{await reload();}catch(e){status.textContent=errText(e);}
  }
  function openSettings() {
    const d = { ...cfg }; const f = (label, el, note) => h('label', { class: 'field' }, h('span', {}, label), el, note ? h('small', {}, note) : null);
    const inp = (k, opts = {}) => { const i = h('input', { value: d[k] ?? '', ...opts }); i.addEventListener('input', () => (d[k] = i.value.trim())); return i; };
    const sel = (k, options, cb) => { const s = h('select', {}, options.map(([v, t]) => h('option', { value: v, selected: v === d[k] }, t))); s.addEventListener('change', () => { d[k] = s.value; cb && cb(); }); return s; };
    const voiceSel = h('select'); const fillVoices = () => { voiceSel.replaceChildren(...cfg.voices[d.gender].map(v => h('option', { value: v.id, selected: v.id === d.voice }, `${v.id} · ${v.note}`))); if (!cfg.voices[d.gender].some(v => v.id === d.voice)) d.voice = cfg.voices[d.gender][0].id; }; fillVoices(); voiceSel.addEventListener('change', () => (d.voice = voiceSel.value));
    const chk = (k, label) => { const i = h('input', { type: 'checkbox', checked: !!d[k] }); i.addEventListener('change', () => (d[k] = i.checked)); return h('label', { class: 'check inline' }, i, h('span', {}, label)); };
    const err = h('p', { class: 'ob-err', role: 'alert' }); const testOut = h('div', { class: 'steps' });
    const routes = h('textarea', {rows:3}); routes.value = JSON.stringify(d.workerRoutes || []);
    d.workerRouteCredentials = {...(d.workerRouteCredentials || {})};
    const routeKey = provider => {const i=h('input',{type:'password',autocomplete:'off',value:d.workerRouteCredentials[provider]||''});i.addEventListener('input',()=>{d.workerRouteCredentials[provider]=i.value.trim();});return i;};
    const rates = h('textarea', { rows: 3 }); rates.value = JSON.stringify(d.workerModelRates || {});
    const models = h('input', { value: (d.workerAllowedModels || []).join(', ') });
    const body = h('div', { class: 'set-grid' },
      f('AI name', inp('aiName', { maxlength: 24 })), f('Gender', sel('gender', [['female', 'Female'], ['male', 'Male']], fillVoices)), f('Voice', voiceSel), f('Language', sel('lang', [['mix', 'Roman Urdu + English'], ['en', 'English'], ['ur', 'اردو']])),
      f('How I talk', sel('style', [['formal', 'Formal and polite'], ['casual', 'Casual, like a friend'], ['yaar', 'Full yaar mode: playful banter']])), f('Emotion', sel('emotion', [['calm', 'Calm'], ['expressive', 'Expressive'], ['dramatic', 'Very animated']])),
      f('Your name', inp('userName', { maxlength: 40 })), f('Your title', inp('userTitle', { maxlength: 24 })),
      f('Gemini API key', inp('apiKey', { type: 'password', autocomplete: 'off' }), 'Stored only on this computer.'),
      f('Thinking model', inp('textModel'), 'Used for typed chat and crew agents.'), f('Voice model', inp('liveModel'), 'Model names change often. If voice is refused, check Google’s current Live model name.'),
      f('Close voice after', sel('idleMinutes', [[5, '5 minutes of quiet'], [10, '10 minutes of quiet'], [30, '30 minutes of quiet'], [0, 'Never']].map(([a, b]) => [+a, b]), () => (d.idleMinutes = +d.idleMinutes))),
      h('h3', { class: 'set-h' }, 'Crew engine'),
      h('div', { class: 'set-h' }, h('button', { class: 'btn ghost', onclick: () => { m.close(); openCrewConfig(); } }, 'Crew configuration (YAML)')),
      h('div', {class:'set-h'},h('button',{class:'btn ghost',onclick:()=>{m.close();openStorageGuardian();}},'Storage Guardian')),
      f('Managed Home quota (MiB)',inp('storageQuotaMiB',{type:'number',min:512,max:1048576,step:1}),'Admission and native snapshot guard; Docker, external databases and unrestricted host writes are separate.'),
      f('Emergency disk headroom (MiB)',inp('storageReserveMiB',{type:'number',min:128,step:1}),'Kept outside job reservations; does not guarantee writes during physical disk failure.'),
      f('Per-job storage reservation (MiB)',inp('storageJobReserveMiB',{type:'number',min:320,max:4096,step:1}),'Durable queued/running reservations protect bounded native snapshot/input staging. Conservative accounting can refuse early.'),
      f('Recovery protection (days)',inp('storageKeepDays',{type:'number',min:30,max:3650,step:1}),'After this period only human-accepted, unlinked, unpinned recovery is eligible for explicit review; never automatic deletion.'),
      f('Engine', sel('engine', [['builtin', 'Built-in (light, Gemini only)'], ['hermes', 'Hermes Agent (real coding tools)'], ['opencode', 'OpenCode (open-source coding agent)']]), 'Native crew jobs require the approved Docker Linux image below. Direct internet, host folders and unrestricted integrations are blocked.'),
      f('Hermes command', inp('hermesPath', { placeholder: 'hermes' }), 'Host command for Hermes communication services. Native crew jobs use Hermes installed inside the approved image.'),
      f('OpenCode command', inp('opencodePath', { placeholder: 'opencode' }), 'Legacy host command. Native crew jobs use OpenCode installed inside the approved image.'),
      f('Crew provider', sel('workerProvider', [['gemini', 'Google Gemini'], ['openrouter', 'OpenRouter'], ['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['custom', 'Custom endpoint']])),
      f('Crew model', inp('workerModel', { placeholder: 'blank = the Gemini thinking model' }), 'Use a strong tool-calling model for coding.'),
      f('Native runtime image ID', inp('nativeContainerImage', { placeholder: 'sha256: followed by the installed image ID' }), 'Hermes/OpenCode jobs run inside this approved Linux image. It must include Node 20+ and the selected CLI. Orbit never downloads it automatically.'),
      f('Worker model requests per job', inp('workerMaxRequests', { type: 'number', min: 1, max: 500, step: 1 }), 'Counts built-in and broker-mediated native submissions. Legacy native routes, commander chat and voice are outside this limit.'),
      f('Worker deadline (seconds)', inp('workerTimeoutSeconds', { type: 'number', min: 1, max: 86400, step: 1 }), 'Stops Orbit waiting after this execution limit. Inspect prior effects before retrying; external process termination depends on the engine.'),
      f('Worker token budget per job', inp('workerTokenBudget', { type: 'number', min: 0, max: 100000000, step: 1 }), '0 disables. Reserves input plus maximum output before built-in or supported native generation; unsupported native providers are refused.'),
      f('Worker token cost budget (USD)', inp('workerCostBudgetUsd', { type: 'number', min: 0, max: 10000, step: 0.01 }), '0 disables. Requires explicit model prices below; this covers mediated token charges, not all provider fees or OS-level bypasses.'),
      f('Reserved output tokens per request', inp('workerMaxOutputTokens', { type: 'number', min: 1, max: 65536, step: 1 }), 'Maximum generated output/thinking tokens for a budgeted request.'),
      f('Native model routes (JSON)', routes, 'Optional explicit Gemini/OpenAI/Anthropic candidates: provider, model, contextTokens, capabilities [text, tools]. Catalog availability and entered prices rank routes. Saves authorize history transfer to these providers; unknown generation failures never automatically replay.'),
      ...['gemini','openai','anthropic'].map(p => f('Router ' + p + ' key', routeKey(p), 'Optional protected routing credential; blank can reuse the current provider key.')),
      f('Worker model allowlist', models, 'Comma-separated model IDs. Enforced for built-in and supported native broker requests. Unsupported native providers are refused when configured.'),
      f('Model token prices (USD per million)', rates, 'JSON: {"model-id":{"input":0.3,"output":2.5}}. Enter verified prices; Orbit does not guess them.'),
      f('Crew API key', inp('workerApiKey', { type: 'password', autocomplete: 'off', placeholder: 'blank = reuse Gemini key' })),
      f('Custom base URL', inp('workerBaseUrl', { placeholder: 'https://.../v1' }), 'Only for the custom provider.'),
      h('div', { class: 'set-test' }, h('button', { class: 'btn ghost', onclick: async () => {
        testOut.textContent = 'Saving and testing. This can take up to a minute…';
        try { cfg = await bridge.config.save(d); const r = await (d.engine === 'opencode' ? bridge.opencode.check({ smoke: true }) : bridge.hermes.check({ smoke: true }));
          testOut.replaceChildren(...r.steps.map(x => h('div', { class: 'step ' + (x.ok ? 'ok' : 'bad') }, h('b', {}, (x.ok ? '✓ ' : '✗ ') + x.name), h('small', {}, x.detail))));
        } catch (e) { testOut.textContent = errText(e); } } }, 'Check runtime'), testOut),
      h('div', { class: 'checks' }, chk('nativeContinuity', 'Preserve protected native history and pinned Hermes/OpenCode session databases (explicit retry; fresh permissions)'), chk('autostart', 'Start when I sign in'), chk('sfx', 'Ship sounds'), chk('autoWake', 'Open voice automatically on start'), chk('launchOnStart', 'Launch from the pad at every start'), chk('launchFilmFull', 'Long launch film (about 18 seconds)'), chk('shutdownSequence', 'Power-down sequence when I quit'), chk('classicLook', 'Classic cockpit look (game style) instead of the holographic one'), chk('safeMode', 'Safe Mode (confirm every file write, even inside my own workspace)'), chk('modelDecision', 'Model decision (a small model classifies each message; can add a few seconds)'), chk('smartRoute', 'Smart routing (use the lighter model for simple chat)')), err);
    const recommission = h('button', { class: 'btn ghost danger', onclick: async () => { if (recommission.dataset.sure) { await bridge.config.reset(); location.reload(); } else { recommission.dataset.sure = '1'; recommission.textContent = 'Click again to confirm'; } } }, 'Recommission from scratch');
    const m = modal('Settings', body, [recommission, h('span', { class: 'grow' }), h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
      try {
        const voiceChanged = ['aiName', 'gender', 'voice', 'lang', 'userName', 'userTitle', 'liveModel', 'apiKey', 'style', 'emotion'].some(k => d[k] !== cfg[k]);
        if (!d.aiName || !d.userName) throw new Error('Both names are required');
        d.workerModelRates = JSON.parse(rates.value);
        d.workerRoutes = JSON.parse(routes.value);
        d.workerAllowedModels = models.value.split(',').map(s => s.trim()).filter(Boolean);
        cfg = await bridge.config.save(d); window.__holo && __holo.apply(cfg); SFX.enable(cfg.sfx); cfg.sfx ? SFX.hum(true) : SFX.hum(false); $('#hud-name').textContent = cfg.aiName; town.setCommander({ name: cfg.aiName });
        if (voiceChanged && live.want) { live.stop(); addMsg('sys', 'Settings saved. Wake voice again to apply the new voice settings.'); } else addMsg('sys', 'Settings saved.');
        paintState(); m.close();
      } catch (e) { err.textContent = errText(e); }
    } }, 'Save')], { cls: 'settings' });
  }

  const STATE_TEXT = { connected: ['Connected', 'ok'], retrying: ['Cannot connect', 'bad'], starting: ['Starting…', 'warn'], connecting: ['Connecting…', 'warn'], stopped: ['Stopped', ''], disconnected: ['Disconnected', 'bad'], off: ['Off', ''], fatal: ['Rejected', 'bad'] };
  const FATAL_HINT = { telegram: 'Check the bot token in Settings > Comms hub.' };
  async function openComms() {
    const { settings: cur, status } = await bridge.comms.get();
    const d = JSON.parse(JSON.stringify(cur)); const err = h('div', { class: 'ob-err', role: 'alert' });
    const stat = {}; const pill = k => (stat[k] = h('span', { class: 'cstate' }));
    const errEl = {}; const errLine = k => { if (!errEl[k]) errEl[k] = h('small', { class: 'ccard-err', hidden: true }); return errEl[k]; };
    const paintStatus = st => {
      for (const k of ['telegram', 'whatsapp', 'email']) {
        const p = st.platforms[k] || { state: 'off' }; const [t, c] = STATE_TEXT[p.state] || [p.state, '']; stat[k].className = 'cstate ' + c; stat[k].textContent = t;
        const msg = p.error || (p.state === 'fatal' && FATAL_HINT[k] ? FATAL_HINT[k] : '');
        stat[k].title = msg;
        const line = errLine(k); line.hidden = !msg; line.textContent = msg;
      }
      if (waNote) waNote.textContent = st.whatsappPaired ? 'A phone is paired.' : 'No phone paired yet.';
    };
    const inp = (obj, k, o = {}) => { const i = h('input', { value: Array.isArray(obj[k]) ? obj[k].join(', ') : (obj[k] ?? ''), ...o }); i.addEventListener('input', () => (obj[k] = i.value.trim())); return i; };
    const on = (obj, label) => { const i = h('input', { type: 'checkbox', checked: !!obj.enabled }); i.addEventListener('change', () => (obj.enabled = i.checked)); return h('label', { class: 'check inline' }, i, h('span', {}, label)); };
    const f = (label, el, note) => h('label', { class: 'field' }, h('span', {}, label), el, note ? h('small', {}, note) : null);
    const tg = d.telegram, wa = d.whatsapp, em = d.email; let waNote;
    waNote = h('small', { class: 'wanote' }, status.whatsappPaired ? 'A phone is paired.' : 'No phone paired yet.');
    const manual = h('pre', { class: 'perm-detail', hidden: true });
    const pcSel = h('select', {}, [['approve', 'Yes, ask me before risky commands'], ['off', 'No, chat only']].map(([v, t]) => h('option', { value: v, selected: v === d.pcControl }, t))); pcSel.addEventListener('change', () => (d.pcControl = pcSel.value));
    const body = h('div', { class: 'comms-form' },
      h('p', { class: 'perm-who' }, 'This is the AI’s own inbox. Only the people you list can command it. Everyone else is ignored.'),
      f('Can it use my PC from chat?', pcSel, 'With approval on, risky shell commands ask you in the chat first. Destructive ones are blocked. Email never gets a shell.'),
      h('section', { class: 'ccard' }, h('div', { class: 'chead' }, on(tg, 'Telegram'), pill('telegram'), errLine('telegram')),
        f('Bot token', inp(tg, 'token', { type: 'password', autocomplete: 'off', placeholder: '123456789:AA…' }), 'Create a bot with @BotFather.'),
        f('Who may command it (Telegram IDs)', inp(tg, 'allowed', { placeholder: '123456789' }), 'Message @userinfobot to get your numeric ID.')),
      h('section', { class: 'ccard' }, h('div', { class: 'chead' }, on(wa, 'WhatsApp'), pill('whatsapp'), errLine('whatsapp')),
        f('Who may command it (numbers with country code)', inp(wa, 'allowed', { placeholder: '923001234567' }), 'Use a dedicated SIM for the AI. WhatsApp may restrict unofficial bots, so never use your main number.'),
        h('div', { class: 'ob-row' }, h('button', { class: 'btn ghost', onclick: async () => { const r = await bridge.comms.pair(); manual.hidden = false; manual.textContent = (r.ok ? 'A terminal opened with the QR code. On the AI’s phone: WhatsApp, Settings, Linked devices, Link a device.\n\nOr run it yourself:\n' : (r.error || '') + '\n') + r.manual; } }, 'Pair phone'), waNote), manual),
      h('section', { class: 'ccard' }, h('div', { class: 'chead' }, on(em, 'Email'), pill('email'), errLine('email')),
        f('The AI’s own email address', inp(em, 'address', { placeholder: 'nova@gmail.com' })),
        f('App password', inp(em, 'password', { type: 'password', autocomplete: 'off' }), 'Gmail: turn on 2-step verification, then create an app password.'),
        h('div', { class: 'set-grid' }, f('IMAP host', inp(em, 'imapHost', { placeholder: 'imap.gmail.com' })), f('SMTP host', inp(em, 'smtpHost', { placeholder: 'smtp.gmail.com' }))),
        f('Who may command it (email addresses)', inp(em, 'allowed', { placeholder: 'you@example.com' }), 'Mail from anyone else is ignored.')),
      err);
    const m = modal('Comms hub', body, [h('button', { class: 'btn ghost', onclick: async () => { await bridge.comms.stop(); paintStatus(await bridge.comms.status()); } }, 'Stop gateway'), h('span', { class: 'grow' }), h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Close'),
      h('button', { class: 'btn primary', onclick: async () => { err.textContent = 'Connecting…'; const r = await bridge.comms.save(d); err.innerHTML = ''; if (!r.ok) { err.append(...r.errors.map(e => h('div', {}, e))); return; } err.textContent = ''; addMsg('sys', 'Comms hub saved.'); paintStatus(await bridge.comms.status()); } }, 'Save and connect')], { cls: 'settings comms' });
    paintStatus(status); window.__commsStatus = paintStatus;
    const obs = new MutationObserver(() => { if (!document.body.contains(m.back)) { window.__commsStatus = null; obs.disconnect(); } }); obs.observe(modals(), { childList: true });
  }
  function openAddCrew() {
    const v = { name: '', role: '', personality: '', allowCode: true }; const err = h('p', { class: 'ob-err', role: 'alert' });
    const codeCb = h('input', { type: 'checkbox', style: 'width:auto;margin:0' }); codeCb.checked = true; codeCb.addEventListener('change', () => { v.allowCode = codeCb.checked; });
    const codeRow = h('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:8px' }, codeCb, h('span', {}, 'Allow running code (Hermes engine only)'));
    const f = (label, k, ph, area) => { const i = h(area ? 'textarea' : 'input', { placeholder: ph, rows: area ? 3 : null, maxlength: area ? 400 : 40 }); i.addEventListener('input', () => (v[k] = i.value.trim())); return h('label', { class: 'field' }, h('span', {}, label), i); };
    const m = modal('Add a crew member', h('div', { class: 'set-grid one' }, f('Name', 'name', 'Alice'), f('Role', 'role', 'Market researcher'), f('How they work (optional)', 'personality', 'Thorough, skeptical, always cites sources', true), codeRow, err),
      [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { if (!v.name || !v.role) { err.textContent = 'Name and role are required'; return; } const r = await bridge.agents.create(v); if (!r.ok) { err.textContent = r.error; return; } m.close(); addMsg('sys', `${v.name} joined the crew. Ask me to give ${v.name} a job.`); } }, 'Create agent')]);
    m.back.querySelector('input').focus();
  }

  // ---------- launch and reveal ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function launchSequence(first = true) {
    document.body.className = 'phase-launch'; $('#onboarding').hidden = true; if (bridge.startup) bridge.startup.mark('launch countdown begins');
    const cd = $('#countdown'), num = $('#cd-num'), line = $('#cd-line'); cd.hidden = false; let skipped = false; const quick = !first && !cfg.launchFilmFull;   // the full film takes about 18 seconds, which felt like a hang
    const skip = h('button', { class: 'link skipbtn', onclick: () => { skipped = true; } }, 'Skip to orbit'); cd.append(skip);
    line.textContent = first ? `${whoFull()}, you have the bridge.` : `Welcome back, ${whoFull()}. Orbit systems coming online.`;
    for (let n = first ? 5 : (quick ? 3 : 4); n >= 1 && !skipped; n--) { num.textContent = `T\u2212${n}`; SFX.tick(); if (n === 3) line.textContent = 'Main engines to ignition sequence.'; await sleep(quick ? 600 : 1000); }
    if (!skipped && !quick) {
      num.classList.add('word'); num.textContent = 'Ignition'; line.textContent = ''; SFX.rumble(13, 0.9); scene.startLaunch();
      const beats = [[0.8, 'Liftoff.'], [4.2, 'Passing through max-Q.'], [7.6, 'Main engine cutoff.'], [10.6, 'Orbit achieved.']];
      let t = 0; for (const [at, txt] of beats) { if (skipped) break; await Promise.race([sleep((at - t) * 1000), new Promise(r => { const i = setInterval(() => { if (skipped) { clearInterval(i); r(); } }, 100); })]); t = at; if (!skipped) num.textContent = txt; }
      await Promise.race([new Promise(r => { scene.onLaunchEnd = r; }), sleep(first ? 20000 : 4500), new Promise(r => { const i = setInterval(() => { if (skipped) { clearInterval(i); r(); } }, 100); })]);   // a slow PC must not stretch the launch
    }
    if (quick && !skipped) { num.classList.add('word'); num.textContent = 'Orbit'; line.textContent = ''; await sleep(500); }
    scene.skipToOrbit(); skip.remove(); cd.hidden = true; await reveal(first);
  }
  async function reveal(first) {
    document.body.className = 'phase-bridge'; await initBridge(); if (bridge.startup) bridge.startup.mark('home screen shown');
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('revealed')));
    if (cfg.sfx && !document.hidden) { SFX.hum(true); if (first) SFX.chime(); }
    started = true;
    if (cfg.apiKey && (first || (cfg.autoWake && !document.hidden))) startVoice({ greet: first ? `[SYSTEM] This is your very first moment online, just after launch. Introduce yourself by name in one or two warm sentences, greet ${cfg.userName} as ${cfg.userTitle}, and ask what the first mission is.` : `[SYSTEM] Orbit just started. Greet ${cfg.userName} in one short sentence.` });
    else addMsg('ai', cfg.apiKey ? `${cfg.aiName} online. Press the mic or Ctrl+Alt+J when you want to talk, ${who()}.` : `${cfg.aiName} here, ${cfg.userTitle}, but my uplink is offline. Add your Gemini key in Settings and I will come alive.`);
  }

  async function initBridge() {
    if (town) return;
    $('#hud-name').textContent = cfg.aiName;
    town = new Town($('#town'), { onSelect: id => showInspector(id) }); town.setCommander({ name: cfg.aiName });
    live = makeLive(); window.__live = live;
    const endBtn = h('button', { class: 'mini', id: 'end-voice', hidden: true, onclick: () => { live.stop(); muted = false; paintState(); } }, 'End voice'); $('.comms .ph').append(endBtn);
    $('#mic').addEventListener('click', () => { if (!live.want) return startVoice({ greet: `[SYSTEM] The user (${whoFull()}) just woke you. Say a very short hello.` }); muted = !muted; live.setMuted(muted); paintState(); });
    $('#attach').addEventListener('click', async () => {
      const p = await bridge.chat.pickFile(); if (!p) return;
      pendingAttach = p; const nameEl = $('#attach-name'); if (nameEl) { nameEl.textContent = p.split(/[\\/]/).pop(); nameEl.hidden = false; }
      $('#msg').focus();
    });
    $('#send').addEventListener('click', () => { const i = $('#msg'); const t = i.value; i.value = ''; sendText(t); });
    $('#msg').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#send').click(); } });
    $('#open-settings').addEventListener('click', openSettings); $('#open-comms').addEventListener('click', openComms); $('#add-crew').addEventListener('click', openAddCrew);
    $('#open-home').addEventListener('click', () => bridge.showInFolder(cfg.homeDir + (bridge.platform === 'win32' ? '\\workspace' : '/workspace')));
    paintState(); await refreshAgents();
    setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $('#met').textContent = `T+ ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; const d = new Date(); $('#hud-clock').textContent = d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }, 1000);
    document.addEventListener('visibilitychange', () => { if (!cfg.sfx) return; SFX.hum(!document.hidden); });
  }

  // ---------- start ----------
  async function main() {
    if (bridge.startup) bridge.startup.mark('page script starts'); cfg = await bridge.config.get(); SFX.enable(cfg.sfx);
    scene = new Scene($('#scene')); presence = new Presence($('#presence')); if (bridge.startup) bridge.startup.mark('3D scene and orb created'); window.__ui = { openComms, get scene() { return scene; }, get town() { return town; }, get presence() { return presence; }, addMsg, logActivity, showPermission, openSettings, openCrewConfig, onTool, refreshAgents, cue };
    $('#w-min').onclick = () => bridge.win.minimize(); $('#w-max').onclick = () => bridge.win.maximize(); $('#w-hide').onclick = () => bridge.win.hide(); $('#w-quit').onclick = () => (window.__shutdown ? __shutdown.begin() : bridge.win.quit());
    addEventListener('keydown', e => { if (e.key === 'F11') bridge.win.fullscreen(); });
    bindBus();
    if (!cfg.commissioned) { document.body.className = 'phase-onboard'; Onboarding.run(cfg, { sfx: SFX, onLaunch: c => { cfg = c; SFX.enable(cfg.sfx); launchSequence(); } }); }
    else if (cfg.launchOnStart !== false && !document.hidden) launchSequence(false);
    else { scene.skipToOrbit(); await reveal(false); }
  }
  main().catch(e => { console.error(e); document.body.append(h('pre', { class: 'fatal' }, 'Orbit failed to start: ' + e.message)); });
})();
