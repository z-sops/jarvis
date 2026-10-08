'use strict';
// A safe window onto the workspace folder (where Laila and the crew save files): list, read, edit, reveal, watch.
// Nothing outside the folder is ever touched, and a file the crew wrote is treated as untrusted data.
const fs = require('fs'), path = require('path');

const TEXT = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.tsv', '.log', '.yaml', '.yml', '.toml', '.ini', '.xml', '.html', '.htm', '.css', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.sql', '.sh', '.bat', '.ps1', '.rst']);
const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv']);
const MAX_TEXT = 1024 * 1024, MAX_IMAGE = 6 * 1024 * 1024, MAX_ENTRIES = 3000, MAX_DEPTH = 6;

function createWorkspace({ root, agents = () => [] }) {
  const rootDir = () => { const r = root(); fs.mkdirSync(r, { recursive: true }); return r; };

  // Turns "Bob/report.md" into a real path, or throws. Rejects .., absolute paths and anything that escapes through a link.
  function resolve(rel) {
    const clean = String(rel == null ? '' : rel).replace(/\\/g, '/').replace(/^\/+/, '');
    if (clean.split('/').some(p => p === '..') || /^[a-zA-Z]:/.test(clean) || clean.includes('\0')) throw new Error('That path is outside the workspace.');
    const base = rootDir(), abs = path.resolve(base, clean);
    const realBase = fs.realpathSync(base);
    let real = abs; try { real = fs.realpathSync(abs); } catch { /* does not exist yet */ }
    const norm = p => (process.platform === 'win32' ? p.toLowerCase() : p), inside = (p, b) => norm(p) === norm(b) || norm(p).startsWith(norm(b) + path.sep);
    if (!inside(real, realBase)) throw new Error('That path is outside the workspace.');
    return { abs, rel: path.relative(base, abs).split(path.sep).join('/') };
  }

  function tree() {
    const base = rootDir(); let count = 0; const byId = new Map(agents().map(a => [a.id, a]));
    const walk = (dir, rel, depth) => {
      let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
      const out = [];
      for (const d of names) {
        if (count >= MAX_ENTRIES) break; if (SKIP.has(d.name) || d.isSymbolicLink()) continue;
        const r = rel ? rel + '/' + d.name : d.name; let st; try { st = fs.statSync(path.join(dir, d.name)); } catch { continue; } count++;
        if (d.isDirectory()) { const n = { name: d.name, rel: r, dir: true, mtime: st.mtimeMs, children: depth < MAX_DEPTH ? walk(path.join(dir, d.name), r, depth + 1) : [] };
          if (!rel && byId.has(d.name)) n.agent = { id: d.name, name: byId.get(d.name).name, role: byId.get(d.name).role }; out.push(n); }
        else out.push({ name: d.name, rel: r, dir: false, size: st.size, mtime: st.mtimeMs, ext: path.extname(d.name).toLowerCase() });
      }
      return out.sort((a, b) => (b.dir - a.dir) || (a.dir ? a.name.localeCompare(b.name) : b.mtime - a.mtime));
    };
    return { root: base, entries: walk(base, '', 0), truncated: count >= MAX_ENTRIES };
  }

  function read(rel) {
    const { abs, rel: r } = resolve(rel); const st = fs.statSync(abs);
    if (st.isDirectory()) return { rel: r, name: path.basename(abs), kind: 'dir' };
    const ext = path.extname(abs).toLowerCase(), info = { rel: r, name: path.basename(abs), ext, size: st.size, mtime: st.mtimeMs };
    if (IMAGE[ext]) { if (st.size > MAX_IMAGE) return { ...info, kind: 'binary', note: 'This image is larger than 6 MB.' }; return { ...info, kind: 'image', mime: IMAGE[ext], dataUrl: `data:${IMAGE[ext]};base64,${fs.readFileSync(abs).toString('base64')}` }; }
    if (TEXT.has(ext) || ext === '') {
      const fd = fs.openSync(abs, 'r'); try { const len = Math.min(st.size, MAX_TEXT), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, 0);
        if (buf.includes(0)) return { ...info, kind: 'binary', note: 'This is not a text file.' };
        return { ...info, kind: 'text', text: buf.toString('utf8'), truncated: st.size > MAX_TEXT, editable: st.size <= MAX_TEXT && TEXT.has(ext) }; } finally { fs.closeSync(fd); }
    }
    return { ...info, kind: 'binary', note: 'Orbit cannot show this kind of file. Use "Show in folder".' };
  }

  // Only existing text files can be edited, and only up to 1 MB.
  function write(rel, text) {
    const { abs, rel: r } = resolve(rel); const ext = path.extname(abs).toLowerCase(); const body = String(text);
    if (!TEXT.has(ext)) throw new Error('Only text files can be edited here.'); if (!fs.existsSync(abs)) throw new Error('That file does not exist.');
    if (Buffer.byteLength(body) > MAX_TEXT) throw new Error('That is more than 1 MB; edit it in an editor instead.');
    fs.writeFileSync(abs, body); const st = fs.statSync(abs); return { rel: r, size: st.size, mtime: st.mtimeMs };
  }

  const reveal = rel => resolve(rel).abs;

  // Calls onChange (debounced) whenever something in the workspace changes. Returns a stop function.
  function watch(onChange, delay = 400) {
    let timer = null, w = null; const fire = () => { clearTimeout(timer); timer = setTimeout(() => { try { onChange(); } catch {} }, delay); };
    try { w = fs.watch(rootDir(), { recursive: true }, fire); w.on('error', () => {}); } catch { /* recursive watching is not available: the screen can still be refreshed by hand */ }
    return () => { clearTimeout(timer); try { w && w.close(); } catch {} };
  }

  return { tree, read, write, reveal, watch, resolve, TEXT };
}

module.exports = { createWorkspace };
