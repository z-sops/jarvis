'use strict';
// Counts what Orbit asks Google for: requests and tokens per day (Google's quota day ends at midnight Pacific time,
// about 12:00 noon in Pakistan), per model, plus the last minute (the free tier limits input tokens per minute).
const fs = require('fs'), path = require('path');
const PT = 'America/Los_Angeles';

const pacificDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: PT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);   // 2026-09-20
function pacificOffsetMin(d) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: PT, timeZoneName: 'longOffset' }).formatToParts(d).find(x => x.type === 'timeZoneName');
  const m = part && /GMT([+-])(\d{2}):(\d{2})/.exec(part.value); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : -480;
}
function msUntilReset(now) {
  const local = new Date(now.getTime() + pacificOffsetMin(now) * 60000);            // its UTC fields read as the Pacific wall clock
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - local.getTime();
}

// Dollars per million tokens (input / output) on the PAID tier. Estimates only: edit here when Google changes prices.
const PRICES = [
  { match: /flash-lite/, in: 0.30, out: 2.50 },
  { match: /3\.8-flash/, in: 0.75, out: 3.75, from2027: { in: 1.50, out: 7.50 } },   // doubles on 1 January 2027
  { match: /2\.5-flash/, in: 0.30, out: 2.50 }
];
function priceFor(model, now) {
  const p = PRICES.find(x => x.match.test(String(model || ''))); if (!p) return null;
  return p.from2027 && now.getFullYear() >= 2027 ? p.from2027 : { in: p.in, out: p.out };
}

function createUsage({ file, now = () => new Date(), keepDays = 60 }) {
  let data = null, timer = null; const recent = []; const listeners = new Set();
  const load = () => {
    if (data) return data;
    try { data = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { data = {}; }
    if (!data.days || typeof data.days !== 'object') data.days = {}; return data;
  };
  const persist = () => {
    try {
      const d = load(); for (const k of Object.keys(d.days).sort().slice(0, -keepDays)) delete d.days[k];
      fs.mkdirSync(path.dirname(file()), { recursive: true }); require('./managed-write').writeFileSync(file(), JSON.stringify(d));
    } catch { /* usage numbers are a convenience: never break the app for them */ }
  };
  const schedule = () => { if (timer) return; timer = setTimeout(() => { timer = null; persist(); }, 2000); timer.unref && timer.unref(); };

  // e: { source: 'bridge' | 'hermes', model, inTok, outTok, req (default 1), failed, run (a whole Hermes run: tokens only), startedAt (ms) }
  function add(e = {}) {
    const d = load(), day = pacificDay(now()), rows = d.days[day] || (d.days[day] = {});
    const source = e.source || 'bridge', model = e.model || 'unknown', key = `${source}:${model}`;
    const r = rows[key] || (rows[key] = { source, model, req: 0, fail: 0, runs: 0, inTok: 0, outTok: 0 });
    const inTok = Math.max(0, +e.inTok || 0), outTok = Math.max(0, +e.outTok || 0);
    if (e.run) r.runs++; else { r.req += e.req == null ? 1 : e.req; if (e.failed) r.fail++; }
    r.inTok += inTok; r.outTok += outTok;
    if (e.agentId) {
      const agents = rows.agents || (rows.agents = {});
      const ar = agents[e.agentId] || (agents[e.agentId] = { req: 0, fail: 0, runs: 0, inTok: 0, outTok: 0, cost: 0 });
      if (e.run) ar.runs++; else { ar.req += e.req == null ? 1 : e.req; if (e.failed) ar.fail++; }
      ar.inTok += inTok; ar.outTok += outTok;
      const ap = priceFor(model, now()); if (ap) ar.cost += (inTok / 1e6) * ap.in + (outTok / 1e6) * ap.out;
    }
    const t1 = now().getTime(); recent.push({ t0: e.startedAt || t1, t1, model, inTok, req: e.run ? 0 : (e.req == null ? 1 : e.req) });
    while (recent.length && recent[0].t1 < t1 - 180000) recent.shift();
    schedule(); for (const fn of listeners) { try { fn(); } catch {} }
  }

  function snapshot() {
    const d = load(), t = now(), day = pacificDay(t), rows = Object.entries(d.days[day] || {}).filter(([k]) => k !== 'agents').map(([, r]) => {
      const p = priceFor(r.model, t); return { ...r, cost: p ? (r.inTok / 1e6) * p.in + (r.outTok / 1e6) * p.out : null };
    });
    const total = rows.reduce((a, r) => ({ req: a.req + r.req, fail: a.fail + r.fail, runs: a.runs + r.runs, inTok: a.inTok + r.inTok, outTok: a.outTok + r.outTok, cost: a.cost + (r.cost || 0), unpriced: a.unpriced || r.cost == null }), { req: 0, fail: 0, runs: 0, inTok: 0, outTok: 0, cost: 0, unpriced: false });
    // The last minute: a long Hermes run is spread evenly over the time it took, not counted all at once when it ends.
    const now1 = t.getTime(), from = now1 - 60000; let mIn = 0, mReq = 0; const byModel = {};
    for (const e of recent) {
      if (e.t1 < from) continue; const span = Math.max(1, e.t1 - e.t0), overlap = Math.max(0, Math.min(e.t1, now1) - Math.max(e.t0, from));
      const f = e.t1 === e.t0 ? 1 : overlap / span; mIn += e.inTok * f; mReq += e.req * f; const bm = byModel[e.model] || (byModel[e.model] = { req: 0, inTok: 0 }); bm.req += e.req * f; bm.inTok += e.inTok * f;
    }
    const byAgent = Object.entries((d.days[day] || {}).agents || {}).map(([agentId, r]) => ({ agentId, ...r }));
    return { day, resetsInMs: msUntilReset(t), rows, total, minute: { inTok: Math.round(mIn), req: Math.round(mReq) }, minuteByModel: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, { req: Math.round(v.req), inTok: Math.round(v.inTok) }])), byAgent };
  }

  return { add, snapshot, flush: persist, onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
}

module.exports = { createUsage, priceFor, pacificDay, msUntilReset, PRICES };
