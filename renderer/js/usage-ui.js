/* Usage meter (Systems panel) and the Stop button (next to Send). Numbers come from the main process; this file only draws them. */
(function () {
  'use strict';
  if (!window.bridge || !bridge.usage) return;
  const h = (tag, attrs = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v); } for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid)); return el; };
  const say = t => { try { window.__ui.addMsg('sys', t); } catch { /* the chat is not ready yet */ } };
  const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(Math.round(n)));
  const money = v => (v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2));
  const TPM = 250000;   // the free-tier limit on input tokens per minute that Google reported for this key (Flash-Lite)

  /* ---------- usage card ---------- */
  const sys = document.querySelector('.panel.sys'), actList = document.getElementById('activity');
  // the card goes just above the Activity heading (which sits directly in the Systems panel)
  const activity = sys && actList && (actList.previousElementSibling && actList.previousElementSibling.parentNode === sys ? actList.previousElementSibling : actList.parentNode === sys ? actList : null);
  let card = null;
  if (sys && activity) {
    const reset = h('span', { class: 'ph-note', id: 'u-reset' });
    const line1 = h('div', { class: 'u-line' }), line2 = h('div', { class: 'u-line dim' }), line3 = null, fill = h('i'), gauge = h('div', { class: 'u-gauge', role: 'img' }, fill), line4 = h('div', { class: 'u-line dim' });
    card = { line1, line2, line4, fill, gauge, reset, box: h('div', { class: 'usage' }, line1, line2, gauge, line4) };
    sys.insertBefore(h('div', { class: 'ph sub' }, h('h3', {}, 'Recorded usage'), reset), activity); sys.insertBefore(card.box, activity);
  }
  function paint(s) {
    if (!card || !s) return; const t = s.total, m = s.minute, pct = Math.min(100, (m.inTok / TPM) * 100);
    card.line1.textContent = ''; card.line1.append(...[h('b', {}, String(t.req)), ' requests \u00B7 ', h('b', {}, fmt(t.inTok)), ' in \u00B7 ', h('b', {}, fmt(t.outTok)), ' out', t.fail ? h('span', { class: 'bad' }, ` \u00B7 ${t.fail} failed`) : ''].filter(Boolean));
    const crew = t.runs ? ` \u00B7 ${t.runs} crew run${t.runs === 1 ? '' : 's'}` : '';
    card.line2.textContent = (t.inTok + t.outTok === 0 ? 'Token cost unavailable (no tokens recorded)' : `About ${money(t.cost)} if paid${t.unpriced ? ' (+ unpriced models)' : ''}`) + crew;
    card.fill.style.width = pct + '%'; card.gauge.className = 'u-gauge' + (pct >= 90 ? ' hot' : pct >= 70 ? ' warm' : ''); card.gauge.setAttribute('aria-label', `Input tokens in the last minute: ${m.inTok} of ${TPM}`);
    card.line4.textContent = `Last minute: ${fmt(m.inTok)} of ${fmt(TPM)} input tokens`;
    const at = new Date(Date.now() + s.resetsInMs), left = Math.round(s.resetsInMs / 60000);
    card.reset.textContent = `resets in ${Math.floor(left / 60)}h ${left % 60}m \u00B7 ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    card.box.title = 'Partial recorded usage, not a complete bill. Requests cover Orbit Gemini calls (chat, search, screen and built-in workers). Legacy Hermes contributes available final run tokens; native OpenCode/Hermes broker budgets and unknown charges remain in their job records. Voice and missing provider usage are not included. Zero recorded tokens does not mean zero consumption or zero cost. The quota day follows midnight Pacific; entered price estimates are not invoices.';
  }
  const poll = () => bridge.usage.get().then(paint).catch(() => {});
  bridge.onBus(({ type, payload }) => { if (type === 'usage') paint(payload); });
  poll(); setInterval(poll, 5000);

  /* ---------- Stop button ---------- */
  const entry = document.querySelector('.panel.comms .entry'), send = document.getElementById('send');
  if (entry && send && bridge.stop) {
    const stop = h('button', { class: 'stop', id: 'stop', type: 'button', hidden: true, 'aria-label': 'Stop everything', title: 'Stop the crew and the answer being written' },
      (() => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); r.setAttribute('x', '5'); r.setAttribute('y', '5'); r.setAttribute('width', '14'); r.setAttribute('height', '14'); r.setAttribute('rx', '2'); r.setAttribute('fill', 'currentColor'); s.append(r); return s; })());
    entry.insertBefore(stop, send);
    const busy = b => { const on = !!b && (b.crew > 0 || b.chat); stop.hidden = !on; document.body.classList.toggle('is-busy', on); stop.title = on ? `Stop everything (${b.crew} crew job${b.crew === 1 ? '' : 's'}${b.chat ? ', a typed answer' : ''})` : 'Nothing is running'; };
    stop.addEventListener('click', async () => { stop.disabled = true; try { const r = await bridge.stop.all(); say(r.crew || r.chat ? `Stopped: ${r.crew} crew job${r.crew === 1 ? '' : 's'}${r.chat ? ' and the answer being written' : ''}.` : 'Nothing was running.'); } catch (e) { say('Stop failed: ' + e.message); } finally { stop.disabled = false; } });
    bridge.onBus(({ type, payload }) => { if (type === 'busy') busy(payload); });
    bridge.stop.busy().then(busy).catch(() => {});
  }
  window.__usage = { paint, fmt };
})();
