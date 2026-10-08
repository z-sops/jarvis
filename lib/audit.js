'use strict';
// A plain list of what Orbit did: one JSON line per action in <home>/logs/actions.jsonl. Secrets are removed before anything is written.
const fs = require('fs'), path = require('path');
const MAX = 2 * 1024 * 1024;
const redact = s => String(s == null ? '' : s)
  .replace(/\b(api[_-]?key|token|secret|password|passwd|pwd)\b(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1$2[removed]')
  .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[key removed]').replace(/\b(sk|pk|ghp|gho|xox[abp])[-_][0-9A-Za-z_\-]{16,}/g, '[key removed]');
const clip = (s, n = 240) => { const t = redact(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function createAudit({ file, now = () => new Date() }) {
  const listeners = new Set();
  function add(entry) {
    const e = { t: now().toISOString(), ...entry }; for (const k of ['detail', 'task', 'error', 'reason']) if (e[k] != null) e[k] = clip(e[k]);
    try {
      const f = file(); fs.mkdirSync(path.dirname(f), { recursive: true });
      try { if (fs.statSync(f).size > MAX) fs.renameSync(f, f + '.1'); } catch {}
      fs.appendFileSync(f, JSON.stringify(e) + '\n');
    } catch { /* the log is a convenience: never break the app for it */ }
    for (const fn of listeners) { try { fn(e); } catch {} }
    return e;
  }
  function tail(n = 200) {
    let text = ''; try { const f = file(), st = fs.statSync(f), len = Math.min(st.size, 600 * 1024), fd = fs.openSync(f, 'r'); try { const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len); text = buf.toString('utf8'); } finally { fs.closeSync(fd); } } catch { return []; }
    const out = []; for (const line of text.split('\n').slice(-n - 1)) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* the first line may be cut in half */ } }
    return out.slice(-n);
  }
  return { add, tail, on: fn => { listeners.add(fn); return () => listeners.delete(fn); }, redact };
}

module.exports = { createAudit, redact };
