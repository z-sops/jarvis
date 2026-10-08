'use strict';
// The permission hub: one place that decides whether something the crew asks for (through the gateway) runs at once, asks the user first, or is refused.
// The question itself is the same permission dialog used everywhere in Orbit.
const SECRET = /\b(ghp_|github_pat_|gho_|ghu_|ghs_|sk_(?:live|test)_|rk_(?:live|test)_|sbp_|lin_api_|xox[baprs]-|AKIA)[A-Za-z0-9_\-]{6,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const redact = s => String(s).replace(SECRET, '***');
// What is about to happen, in a few readable lines (secrets hidden, long values cut).
function summarize(args, max = 700) {
  let out;
  try { const cut = v => (typeof v === 'string' ? (v.length > 240 ? v.slice(0, 240) + '\u2026' : v) : Array.isArray(v) ? v.slice(0, 8).map(cut) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).slice(0, 14).map(([k, x]) => [k, cut(x)])) : v); out = JSON.stringify(cut(args || {}), null, 2); }
  catch { out = String(args); }
  out = redact(out); return out === '{}' ? '(no details)' : out.length > max ? out.slice(0, max) + '\u2026' : out;
}
const humanize = t => String(t).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());

class Hub {
  constructor({ ask, actorName = a => a }) { this.ask = ask; this.actorName = actorName; this.session = new Set(); }
  // level: 'free' | 'ask' | 'blocked' (from the connector's list). Returns { ok, how } or { ok:false, reason: 'blocked' | 'denied' }.
  async authorize({ actor, source, sourceId, tool, level, args, description }) {
    if (level === 'blocked' || !level) return { ok: false, reason: 'blocked' };
    if (level === 'free') return { ok: true, how: 'free' };
    const key = `${actor}|${sourceId}|${tool}`; if (this.session.has(key)) return { ok: true, how: 'session' };
    let a; try { a = await this.ask({ actor, actorName: this.actorName(actor), tool: `${sourceId}__${tool}`, title: `${source}: ${humanize(tool)}`, detail: summarize(args) + (description ? `\n\n${description}` : ''), allowSession: true, sessionLabel: 'Allow this tool for the session' }); } catch { a = 'deny'; }
    if (a === 'deny' || !a) return { ok: false, reason: 'denied' };
    if (a === 'session') this.session.add(key);
    return { ok: true, how: a };
  }
  forgetSession() { this.session.clear(); }
}

module.exports = { Hub, summarize, redact, humanize };
