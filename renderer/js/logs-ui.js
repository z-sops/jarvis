/* Logs tab in the Comms panel: what Orbit did, one line per action (tool calls, jobs, Stop). Secrets were removed before the lines were saved. */
(function () {
  'use strict';
  if (!window.bridge || !bridge.logs) return;
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v); } for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid)); return el; };
  const comms = document.querySelector('.panel.comms'), head = comms && comms.querySelector('.ph'), before = comms && (comms.querySelector('.micbar') || comms.querySelector('.entry'));
  if (!comms || !head || !before) return;
  const NICE = { run_shell: 'Shell command', write_file: 'Write file', read_file: 'Read file', list_dir: 'List folder', web_search: 'Web search', open_url: 'Open link', look_at_screen: 'Look at screen', assign_task: 'Assign job', cancel_job: 'Cancel job', create_agent: 'New crew member', get_system_info: 'System info', remember: 'Remember' };
  const time = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const rows = [], MAX = 500; let showing = false;

  const list = h('div', { class: 'lg-list', role: 'log', 'aria-live': 'off' }), count = h('span', { class: 'lg-count' });
  const q = h('input', { class: 'lg-q', type: 'search', placeholder: 'Search the log', 'aria-label': 'Search the log', oninput: paint });
  const errs = h('input', { type: 'checkbox', id: 'lg-errs', onchange: paint });
  const box = h('div', { id: 'logs', hidden: true }, h('div', { class: 'lg-bar' }, q, h('label', { class: 'lg-chk', for: 'lg-errs' }, errs, 'Problems only'), count, h('button', { class: 'mini', type: 'button', title: 'Show the log file in Explorer', onclick: () => bridge.logs.reveal() }, 'Log file')), list);
  comms.insertBefore(box, before);
  const tChat = h('button', { class: 'ph-tab on', type: 'button', role: 'tab', 'aria-selected': 'true', onclick: () => view(false) }, 'Chat'), tLogs = h('button', { class: 'ph-tab', type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => view(true) }, 'Logs');
  head.insertBefore(h('div', { class: 'ph-tabs', role: 'tablist' }, tChat, tLogs), head.querySelector('.ph-note'));

  const tone = e => (e.kind === 'connector' ? (e.status === 'error' ? 'bad' : 'ok') : e.kind === 'browser' ? (e.status === 'ok' ? 'ok' : e.status === 'denied' || e.status === 'error' ? 'bad' : 'warn') : e.kind === 'tool' ? (e.status === 'done' ? 'ok' : e.status === 'denied' ? 'warn' : 'bad') : e.kind === 'job' ? (e.event === 'failed' ? 'bad' : e.event === 'cancelled' ? 'warn' : 'ok') : 'warn');
  function line(e) {
    const t = tone(e); let who = '', what = '', extra = '';
    if (e.kind === 'connector') { who = 'Connectors'; what = e.action + (e.status === 'error' ? ' \u00B7 failed' : ''); extra = e.detail || ''; }
    else if (e.kind === 'browser') { who = e.actor || ''; what = 'browser ' + e.action + (e.status === 'ok' ? '' : ' \u00B7 ' + e.status); extra = e.reason || e.detail || ''; }
    else if (e.kind === 'tool') { who = e.actor || ''; what = (NICE[e.name] || e.name) + (e.status === 'done' ? '' : e.status === 'denied' ? ' \u00B7 denied' : ' \u00B7 failed'); extra = e.reason || e.detail || ''; }
    else if (e.kind === 'job') { who = e.agent || ''; what = 'job ' + e.event; extra = e.error || e.task || ''; }
    else { who = 'Stop'; what = ''; extra = e.detail || ''; }
    return { t, text: `${who} ${what} ${extra}`.toLowerCase(), node: h('div', { class: 'lg-row ' + t }, h('span', { class: 'lg-t' }, time(e.t)), h('i', { class: 'lg-dot' }), h('span', { class: 'lg-who' }, who), h('span', { class: 'lg-what' }, what), h('span', { class: 'lg-x', title: extra }, extra), e.ms != null && e.kind === 'tool' ? h('span', { class: 'lg-ms' }, e.ms >= 1000 ? (e.ms / 1000).toFixed(1) + 's' : e.ms + 'ms') : null) };
  }
  function paint() {
    const f = q.value.trim().toLowerCase(), only = errs.checked, atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40; list.textContent = '';
    const shown = rows.filter(r => (!f || r.text.includes(f)) && (!only || r.t !== 'ok')); for (const r of shown) list.append(r.node);
    if (!shown.length) list.append(h('div', { class: 'lg-empty' }, rows.length ? 'Nothing matches.' : 'Nothing has happened yet. Tool calls and jobs will be listed here.'));
    count.textContent = shown.length + (shown.length === 1 ? ' line' : ' lines'); if (atEnd) list.scrollTop = list.scrollHeight;
  }
  function add(e) { rows.push(line(e)); while (rows.length > MAX) rows.shift(); if (showing) paint(); }
  async function view(on) {
    showing = on; comms.classList.toggle('show-logs', on); box.hidden = !on; tChat.classList.toggle('on', !on); tLogs.classList.toggle('on', on); tChat.setAttribute('aria-selected', String(!on)); tLogs.setAttribute('aria-selected', String(on));
    if (on) { paint(); list.scrollTop = list.scrollHeight; }
  }
  bridge.logs.tail(300).then(es => { rows.length = 0; for (const e of es) rows.push(line(e)); if (showing) paint(); }).catch(() => {});
  bridge.onBus(({ type, payload }) => { if (type === 'audit') add(payload); });
  window.__logs = { view, add };
})();
