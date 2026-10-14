'use strict';
// How much of Google's free allowance is used, model by model. The limits are Google's, per project and per model, and they change with
// billing; the defaults below are what Zee's AI Studio (project nurseos, free tier, 21 September 2026) showed. They can be edited in Orbit.
const fs = require('fs');
const path = require('path');

const DEFAULT_LIMITS = [                                    // the more specific match first
  { match: 'flash-lite', name: 'Flash Lite', rpm: 15, tpm: 250000, rpd: 500 },
  { match: 'live', name: 'Live (voice)', rpm: null, tpm: 65000, rpd: null },
  { match: 'flash', name: 'Flash', rpm: 5, tpm: 250000, rpd: 20 }
];
const num = v => (v === null || v === '' || v === undefined ? null : (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : NaN));
function cleanLimits(list) {
  if (!Array.isArray(list) || !list.length || list.length > 12) throw new Error('Give between 1 and 12 rows.');
  return list.map((r, i) => {
    const match = String(r && r.match || '').trim().toLowerCase().slice(0, 40); if (!match) throw new Error(`Row ${i + 1}: write a part of the model name, for example "flash-lite".`);
    const out = { match, name: String(r.name || match).trim().slice(0, 30) || match, rpm: num(r.rpm), tpm: num(r.tpm), rpd: num(r.rpd) };
    for (const k of ['rpm', 'tpm', 'rpd']) if (Number.isNaN(out[k])) throw new Error(`Row ${i + 1}: ${k.toUpperCase()} must be a number above zero, or empty for unlimited.`);
    return out;
  });
}
function loadLimits(file) { try { return cleanLimits(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return DEFAULT_LIMITS.map(x => ({ ...x })); } }
function saveLimits(file, list) { const c = cleanLimits(list); fs.mkdirSync(path.dirname(file), { recursive: true }); require('./managed-write').writeFileSync(file, JSON.stringify(c, null, 1)); return c; }
const limitFor = (model, limits) => { const m = String(model || '').toLowerCase(); return (limits || []).find(l => m.includes(l.match)) || null; };
const pretty = id => String(id || 'unknown').replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());
const pct = (used, limit) => (limit ? Math.round((used / limit) * 100) : null);
const worst = (...p) => Math.max(0, ...p.filter(x => x !== null));

// snapshot: usage.snapshot() (rows per source+model for the Pacific day, minuteByModel); focus: models to show even if unused today
function view(snapshot, limits, { focus = [] } = {}) {
  const by = new Map(), ensure = m => { if (!by.has(m)) by.set(m, { model: m, req: 0, fail: 0, inTok: 0, outTok: 0, crewRuns: 0 }); return by.get(m); };
  for (const r of (snapshot && snapshot.rows) || []) { const x = ensure(r.model || 'unknown'); if (r.source === 'hermes') x.crewRuns += r.runs || 0; x.req += r.req || 0; x.fail += r.fail || 0; x.inTok += r.inTok || 0; x.outTok += r.outTok || 0; }
  for (const m of focus) if (m) ensure(m);
  const mm = (snapshot && snapshot.minuteByModel) || {};
  const rows = [...by.values()].filter(x => x.model !== 'unknown' || x.req || x.inTok).map(x => {
    const lim = limitFor(x.model, limits), min = mm[x.model] || { req: 0, inTok: 0 };
    const rpd = lim && lim.rpd ? { used: x.req, limit: lim.rpd, pct: pct(x.req, lim.rpd) } : null, rpm = lim && lim.rpm ? { used: min.req, limit: lim.rpm, pct: pct(min.req, lim.rpm) } : null, tpm = lim && lim.tpm ? { used: min.inTok, limit: lim.tpm, pct: pct(min.inTok, lim.tpm) } : null;
    const w = worst(rpd && rpd.pct, rpm && rpm.pct, tpm && tpm.pct);
    return { ...x, name: lim ? lim.name : pretty(x.model), known: !!lim, rpd, rpm, tpm, minute: min, level: w >= 100 ? 'hot' : w >= 80 ? 'warm' : 'ok', worst: w };
  });
  const rank = { hot: 0, warm: 1, ok: 2 }; rows.sort((a, b) => rank[a.level] - rank[b.level] || b.req - a.req);
  return rows;
}

// Tells you once per model per day (and once per limit) when a limit passes 80% and again when it is reached.
function createWatcher({ day = () => new Date().toISOString().slice(0, 10), emit }) {
  const told = new Set(); let today = '';
  return function check(rows) {
    const d = day(); if (d !== today) { today = d; told.clear(); }
    for (const r of rows) for (const [kind, q, label] of [['rpd', r.rpd, 'requests today'], ['rpm', r.rpm, 'requests this minute'], ['tpm', r.tpm, 'input tokens this minute']]) {
      if (!q || q.pct === null) continue; const level = q.pct >= 100 ? 100 : q.pct >= 80 ? 80 : 0; if (!level) continue;
      const key = `${r.model}|${kind}|${level}`; if (kind !== 'rpd' && level === 80) continue;   // a busy minute is normal; only the daily allowance gets an early warning
      if (told.has(key)) continue; told.add(key);
      const nf = n => (n >= 1000 ? Math.round(n / 100) / 10 + 'K' : String(n));
      emit({ model: r.model, name: r.name, kind, level, used: q.used, limit: q.limit, text: level >= 100 ? `${r.name}: the limit for ${label} is reached (${nf(q.used)} of ${nf(q.limit)}).${kind === 'rpd' ? ' It starts again when the day resets.' : ' It clears within a minute.'}` : `${r.name}: ${nf(q.used)} of ${nf(q.limit)} ${label} used (${q.pct}%).` });
    }
  };
}

/* ---------- which models the key can use ---------- */
const skip = /(tts|image|audio|embed|robotics|translate|transcribe|vision|imagen|veo|aqa)/;
const verNum = id => (id.match(/(\d+(?:\.\d+)*)/) || [, '0'])[1].split('.').map(Number);
const cmpVer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 4; i++) { const d = (y[i] || 0) - (x[i] || 0); if (d) return d; } return 0; };
function pickModels(apiModels, limits) {
  const all = (apiModels || []).map(m => ({ id: String(m.name || '').replace(/^models\//, ''), methods: m.supportedGenerationMethods || [] })).filter(m => /^gemini-/.test(m.id));
  const everyday = all.filter(m => m.methods.includes('generateContent') && /flash/.test(m.id) && !/live/.test(m.id) && !skip.test(m.id)).map(m => ({ id: m.id, lite: /lite/.test(m.id), preview: /preview|exp/.test(m.id), limit: limitFor(m.id, limits) }));
  everyday.sort((a, b) => (a.preview - b.preview) || cmpVer(a.id, b.id));
  const lites = everyday.filter(m => m.lite && !m.preview), recommended = (lites[0] || everyday.find(m => m.lite) || null);
  return { everyday, recommended: recommended && recommended.id, live: all.filter(m => /live/.test(m.id)).map(m => m.id) };
}
async function listModels(cfg, limits, fetchFn = fetch) {
  if (!cfg.apiKey) throw new Error('No Gemini key is set yet.');
  const res = await fetchFn('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': cfg.apiKey }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Google answered ${res.status} when asked for the model list.`);
  return pickModels((await res.json()).models, limits);
}
const validModelId = id => /^gemini-[a-z0-9][a-z0-9.\-]{2,60}$/.test(String(id || ''));

module.exports = { DEFAULT_LIMITS, cleanLimits, loadLimits, saveLimits, limitFor, view, createWatcher, pickModels, listModels, validModelId, pretty };
