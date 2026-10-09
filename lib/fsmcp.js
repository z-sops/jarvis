'use strict';
// Orbit's own file tools for the crew, written and kept by Orbit (no outside server, no extra package). They work only inside the folders the user
// chose ("roots"); the permission hub decides which of them run at once, ask first, or are blocked. Same tool names as the reference MCP filesystem server.
const fs = require('fs');
const path = require('path');

const MAX_READ = 1000000, MAX_WRITE = 2000000, MAX_LIST = 300, MAX_FOUND = 200, MAX_MATCHES = 100, MAX_TREE = 400;
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.next', 'dist', 'build', '.cache', '.gradle']);
// Secret files are never read or written through the crew's door: a poisoned page could otherwise talk the crew into sending them away.
const SECRET_NAME = /^(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|pfx|p12|kdbx|keystore|jks)|secrets?\.json|credentials(\.json)?|\.git-credentials|token(s)?\.json|\.token)$/i;
const SECRET_DIR = /^(\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.azure|\.config\/gcloud)$/i;

/* ---------- paths ---------- */
const sep = P => P.sep;
const norm = (p, P = path) => { let s = P.resolve(p); if (P === path.win32) s = s.toLowerCase(); return s; };
// Is child the same as root or inside it? (case-insensitive on Windows)
function isInside(child, root, P = path) { const c = norm(child, P), r = norm(root, P); if (c === r) return true; const rs = r.endsWith(sep(P)) ? r : r + sep(P); return c.startsWith(rs); }
const isDriveRoot = (p, P = path) => { const s = P.resolve(p); return P.parse(s).root === s; };

// Which folders may never be a root: the whole drive, the system, the user's profile itself, program settings, and Orbit's own secrets.
function dangerousRoot(p, { home = null, userData = null, userProfile = null, allowUnder = [], P = path } = {}) {
  const s = P.resolve(p), low = s.toLowerCase().replace(/\\/g, '/');
  if (isDriveRoot(s, P)) return 'a whole drive is too much: choose a folder';
  if (/^[a-z]:\/(windows|program files|program files \(x86\)|programdata|system volume information|\$recycle\.bin)(\/|$)/.test(low) || /^\/(etc|bin|sbin|usr|var|boot|proc|sys|dev|root)(\/|$)/.test(low)) return 'that is a system folder';
  if (userProfile && norm(s, P) === norm(userProfile, P)) return 'your whole user folder holds program settings and keys: choose a folder inside it';
  if (/(^|\/)appdata(\/|$)/.test(low) && !allowUnder.some(a => isInside(s, a, P))) return 'AppData holds program settings and logins';   // (allowUnder: only for tests, whose temp folder lives in AppData on Windows)
  for (const seg of low.split('/')) if (SECRET_DIR.test(seg)) return `${seg} holds keys and logins`;
  for (const guard of [home && home.root, userData]) if (guard && (isInside(guard, s, P))) return 'that folder contains Orbit\'s own data (settings and tokens)';
  if (home && isInside(s, home.root, P) && !isInside(s, home.p('workspace'), P)) return 'that is inside Orbit\'s own folder (only its workspace may be used)';
  return '';
}
function checkRoots(list, opts = {}) {
  const P = opts.P || path, out = []; const items = Array.isArray(list) ? list : String(list || '').split(/\r?\n/);
  for (const raw of items) {
    const p = String(raw || '').trim().replace(/^"|"$/g, ''); if (!p) continue;
    if (!P.isAbsolute(p)) return { ok: false, error: `"${p}" is not a full path (like C:\\Users\\you\\Documents).` };
    if (/^[\\/]{2}/.test(p)) return { ok: false, error: 'Network paths (\\\\server\\share) are not allowed.' };
    const why = dangerousRoot(p, opts); if (why) return { ok: false, error: `"${p}": ${why}.` };
    if (!opts.skipExists) { let st; try { st = fs.statSync(p); } catch { return { ok: false, error: `"${p}" does not exist.` }; } if (!st.isDirectory()) return { ok: false, error: `"${p}" is a file, not a folder.` }; const real = fs.realpathSync.native(p); const why2 = dangerousRoot(real, opts); if (why2) return { ok: false, error: `"${p}": ${why2}.` }; out.push(real); }
    else out.push(P.resolve(p));
  }
  if (!out.length) return { ok: false, error: 'Choose at least one folder.' };
  return { ok: true, roots: [...new Set(out)].slice(0, 12) };
}

/* ---------- small helpers ---------- */
const human = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const isBinary = buf => { const n = Math.min(buf.length, 4096); for (let i = 0; i < n; i++) if (buf[i] === 0) return true; return false; };
const globRe = g => new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/\\\\]*').replace(/\?/g, '[^/\\\\]').replace(/\u0000/g, '.*') + '$', 'i');
const ok = text => ({ content: [{ type: 'text', text }], isError: false });
const fail = text => ({ content: [{ type: 'text', text }], isError: true });
class FsError extends Error {}

class FilesProvider {
  // roots: folders (real paths); forbid: folders that are off limits even inside a root; backupDir: where the old version of a changed file is kept; trash(path): moves to the Recycle Bin
  constructor({ roots, forbid = [], backupDir = null, trash = null, P = path }) { this.P = P; this.roots = (roots || []).map(r => { try { return fs.realpathSync.native(r); } catch { return P.resolve(r); } }); this.forbid = forbid; this.backupDir = backupDir; this.trash = trash; this.lastUse = Date.now(); this.sig = JSON.stringify(this.roots); this.url = 'orbit://files'; this.token = ''; }
  abort() {} async close() {}
  get connected() { return true; }

  /* the one gate every path goes through */
  resolve(input, { mustExist = true, forWrite = false, deep = false } = {}) {
    const P = this.P; let s = String(input == null ? '' : input).trim();
    if (!s) throw new FsError('A path is needed.');
    if (s.includes('\0')) throw new FsError('That path is not valid.');
    if (/^[\\/]{2}/.test(s) && P === path.win32) throw new FsError('Network and device paths are not allowed.');
    if (P === path.win32 && (/:[^\\/]|::\$/.test(s.slice(2)))) throw new FsError('That path is not valid.');
    const abs = P.isAbsolute(s) ? P.resolve(s) : P.resolve(this.roots[0] || '.', s);
    let real; try { real = fs.realpathSync.native(abs); } catch (e) {
      if (mustExist) throw new FsError(`Not found: ${s}`);
      if (deep) { let cur = abs; const rest = []; while (!fs.existsSync(cur) && P.dirname(cur) !== cur) { rest.unshift(P.basename(cur)); cur = P.dirname(cur); } real = P.join(fs.realpathSync.native(cur), ...rest); }   // a new folder below folders that do not exist yet: the closest existing folder decides
      else { let parent; try { parent = fs.realpathSync.native(P.dirname(abs)); } catch { throw new FsError(`The folder does not exist: ${P.dirname(s)}`); } real = P.join(parent, P.basename(abs)); }
    }
    if (!this.roots.some(r => isInside(real, r, P))) throw new FsError(`Access denied: ${s} is outside the allowed folders (${this.roots.join(', ')}).`);
    if (this.forbid.some(f => isInside(real, f, P))) throw new FsError('Access denied: that is inside Orbit\'s own data.');
    const parts = real.split(/[\\/]/); for (const seg of parts) if (SECRET_DIR.test(seg)) throw new FsError(`Access denied: ${seg} holds keys and logins.`);
    if (SECRET_NAME.test(P.basename(real))) throw new FsError('Access denied: Orbit does not read or change secret files (.env, keys, tokens).');
    if (forWrite && parts.includes('.git')) throw new FsError('Access denied: Orbit does not change files inside .git.');
    return real;
  }

  async listTools() {
    const RO = { readOnlyHint: true, openWorldHint: false }, W = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, C = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
    const pathP = d => ({ type: 'string', description: d || 'A full path inside an allowed folder' });
    return [
      { name: 'list_allowed_directories', description: 'The folders these file tools may use. Everything else is refused.', inputSchema: { type: 'object', properties: {} }, annotations: RO },
      { name: 'list_directory', description: 'List the files and folders inside a folder, with sizes.', inputSchema: { type: 'object', properties: { path: pathP() }, required: ['path'] }, annotations: RO },
      { name: 'directory_tree', description: 'A tree of a folder, a few levels deep (skips node_modules, .git and similar).', inputSchema: { type: 'object', properties: { path: pathP(), depth: { type: 'number', description: 'How many levels (default 3, at most 6)' } }, required: ['path'] }, annotations: RO },
      { name: 'read_text_file', description: 'Read text (up to 1 MB) or use offset/limit for a bounded UTF-8 byte window. Continue with returned nextOffset. Window mode cannot combine with head/tail. Secret files are refused.', inputSchema: { type: 'object', properties: { path: pathP(), head: { type: 'number', description: 'Only the first N lines' }, tail: { type: 'number', description: 'Only the last N lines' }, offset: { type: 'integer', description: 'Byte offset, use previous nextOffset.' }, limit: { type: 'integer', minimum: 4, maximum: 20000, description: 'Byte window limit, default 20000.' } }, required: ['path'] }, annotations: RO },
      { name: 'read_multiple_files', description: 'Read several small text files at once (at most 8).', inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Full paths' } }, required: ['paths'] }, annotations: RO },
      { name: 'search_files', description: 'Find files and folders by name (wildcards * and ?), for example *.js or report*.', inputSchema: { type: 'object', properties: { path: pathP('Where to search'), pattern: { type: 'string', description: 'Name pattern' } }, required: ['path', 'pattern'] }, annotations: RO },
      { name: 'search_text', description: 'Find text inside files (plain text, not case sensitive). Returns file, line and the line itself.', inputSchema: { type: 'object', properties: { path: pathP('Where to search'), query: { type: 'string', description: 'Text to find' }, filePattern: { type: 'string', description: 'Only files with this name pattern, like *.js' } }, required: ['path', 'query'] }, annotations: RO },
      { name: 'get_file_info', description: 'Size, type and dates of a file or folder.', inputSchema: { type: 'object', properties: { path: pathP() }, required: ['path'] }, annotations: RO },
      { name: 'write_file', description: 'Create a file or replace its whole content (up to 2 MB). The old version is kept in Orbit\'s backups.', inputSchema: { type: 'object', properties: { path: pathP(), content: { type: 'string', description: 'The whole new content' } }, required: ['path', 'content'] }, annotations: W },
      { name: 'edit_file', description: 'Change a file by replacing exact pieces of text. Each oldText must appear exactly once. Set dryRun to see the result without saving.', inputSchema: { type: 'object', properties: { path: pathP(), edits: { type: 'array', items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['oldText', 'newText'] } }, dryRun: { type: 'boolean' } }, required: ['path', 'edits'] }, annotations: W },
      { name: 'create_directory', description: 'Create a folder (and any missing folders above it).', inputSchema: { type: 'object', properties: { path: pathP() }, required: ['path'] }, annotations: C },
      { name: 'move_file', description: 'Move or rename a file or folder. It never overwrites: the destination must not exist.', inputSchema: { type: 'object', properties: { source: pathP(), destination: pathP() }, required: ['source', 'destination'] }, annotations: W },
      ...(this.trash ? [{ name: 'trash_file', description: 'Move a file or folder to the Recycle Bin (it can be restored from there).', inputSchema: { type: 'object', properties: { path: pathP() }, required: ['path'] }, annotations: W }] : [])
    ];
  }

  async callTool(name, a = {}) {
    this.lastUse = Date.now();
    try { const fn = this['t_' + name]; if (!fn) return fail(`Unknown tool ${name}.`); return ok(await fn.call(this, a || {})); }
    catch (e) { return fail(e instanceof FsError ? e.message : `That failed: ${String((e && e.message) || e).slice(0, 200)}`); }
  }

  t_list_allowed_directories() { return `Allowed folders:\n${this.roots.join('\n')}`; }
  t_list_directory({ path: p }) {
    const d = this.resolve(p); if (!fs.statSync(d).isDirectory()) throw new FsError('That is a file, not a folder.');
    const out = []; let hidden = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SECRET_NAME.test(e.name) || SECRET_DIR.test(e.name)) { hidden++; continue; } let size = ''; if (e.isFile()) { try { size = ' (' + human(fs.statSync(this.P.join(d, e.name)).size) + ')'; } catch { /* unreadable */ } } out.push(`${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}${size}`); }
    out.sort((x, y) => (x.startsWith('[DIR]') === y.startsWith('[DIR]') ? x.localeCompare(y) : x.startsWith('[DIR]') ? -1 : 1));
    return `${d}\n${out.slice(0, MAX_LIST).join('\n') || '(empty)'}${out.length > MAX_LIST ? `\n(... ${out.length - MAX_LIST} more)` : ''}${hidden ? `\n(${hidden} secret item${hidden === 1 ? '' : 's'} not shown)` : ''}`;
  }
  t_directory_tree({ path: p, depth = 3 }) {
    const root = this.resolve(p), max = Math.max(1, Math.min(6, +depth || 3)); let count = 0; const lines = [];
    const walk = (dir, level, prefix) => { let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } list.sort((x, y) => (x.isDirectory() === y.isDirectory() ? x.name.localeCompare(y.name) : x.isDirectory() ? -1 : 1));
      for (const e of list) { if (count >= MAX_TREE) return; if (SECRET_NAME.test(e.name) || SECRET_DIR.test(e.name)) continue; count++; lines.push(`${prefix}${e.isDirectory() ? e.name + '/' : e.name}`); if (e.isDirectory() && !SKIP_DIRS.has(e.name) && level < max && !e.isSymbolicLink()) walk(this.P.join(dir, e.name), level + 1, prefix + '  '); } };
    walk(root, 1, ''); return `${root}\n${lines.join('\n') || '(empty)'}${count >= MAX_TREE ? '\n(... cut: a big folder)' : ''}`;
  }
  readText(real) { const st = fs.statSync(real); if (!st.isFile()) throw new FsError('That is a folder, not a file.'); return st; }
  t_read_text_file({ path: p, head, tail, offset, limit }) {
    const f = this.resolve(p), st = this.readText(f);
    if (offset !== undefined || limit !== undefined) {
      if (head !== undefined || tail !== undefined) throw new FsError('Byte window mode cannot combine with head or tail.');
      return JSON.stringify(require('./text-window').readTextWindow(f, { offset, limit }));
    }
    if (head !== undefined && tail !== undefined) throw new FsError('Use head or tail, not both.');
    for (const value of [head, tail]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 5000)) throw new FsError('Head/tail must be an integer from 1 to 5000.');
    if (!head && !tail && st.size > MAX_READ) throw new FsError(`That file is ${human(st.size)}; the limit is 1 MB. Use head or tail to read part of it.`);
    const fd = fs.openSync(f, 'r'); let buf; const start = tail ? Math.max(0, st.size - 8000000) : 0;
    try { const n = Math.min(st.size, head || tail ? 8000000 : MAX_READ); buf = Buffer.alloc(n); const read = fs.readSync(fd, buf, 0, n, start); buf = buf.subarray(0, read); } finally { fs.closeSync(fd); }
    if (isBinary(buf)) throw new FsError('That looks like a binary file, not text.');
    if (start) { const newline = buf.indexOf(10); if (newline < 0) throw new FsError('The final line exceeds the bounded tail scan. Use offset/limit windows.'); buf = buf.subarray(newline + 1); }
    let text = buf.toString('utf8'); if (head) text = text.split('\n').slice(0, Math.min(5000, +head)).join('\n'); else if (tail) text = text.split('\n').slice(-Math.min(5000, +tail)).join('\n');
    return text.length > MAX_READ ? text.slice(0, MAX_READ) + '\n(... cut at 1 MB)' : text;
  }
  t_read_multiple_files({ paths }) {
    if (!Array.isArray(paths) || !paths.length) throw new FsError('Give a list of paths.'); let total = 0; const out = [];
    for (const p of paths.slice(0, 8)) { try { const t = this.t_read_text_file({ path: p }); total += t.length; if (total > MAX_READ) { out.push(`${p}: (cut: too much text in total)`); break; } out.push(`--- ${p}\n${t}`); } catch (e) { out.push(`--- ${p}\nError: ${e.message}`); } }
    return out.join('\n\n') + (paths.length > 8 ? '\n(only the first 8 were read)' : '');
  }
  walkFiles(root, visit, limit = 20000) { let n = 0; const go = dir => { let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of list) { if (n++ > limit) return; if (SECRET_NAME.test(e.name) || SECRET_DIR.test(e.name) || e.isSymbolicLink()) continue; const full = this.P.join(dir, e.name); if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) go(full); } else if (visit(full, e) === false) return; } }; go(root); }
  t_search_files({ path: p, pattern }) {
    const root = this.resolve(p), re = globRe(String(pattern || '*')), found = []; if (!String(pattern || '').trim()) throw new FsError('A name pattern is needed, like *.js');
    const go = dir => { let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of list) { if (found.length >= MAX_FOUND) return; if (SECRET_NAME.test(e.name) || SECRET_DIR.test(e.name) || e.isSymbolicLink()) continue; const full = this.P.join(dir, e.name); if (re.test(e.name)) found.push(full); if (e.isDirectory() && !SKIP_DIRS.has(e.name)) go(full); } };
    go(root); return found.length ? found.join('\n') + (found.length >= MAX_FOUND ? '\n(... more not shown)' : '') : 'No matches.';
  }
  t_search_text({ path: p, query, filePattern }) {
    const q = String(query || '').toLowerCase(); if (!q) throw new FsError('Text to find is needed.'); const root = this.resolve(p), fre = filePattern ? globRe(filePattern) : null, hits = [];
    const one = full => { if (fre && !fre.test(this.P.basename(full))) return; let st; try { st = fs.statSync(full); } catch { return; } if (st.size > MAX_READ) return; let buf; try { buf = fs.readFileSync(full); } catch { return; } if (isBinary(buf)) return; const lines = buf.toString('utf8').split('\n'); for (let i = 0; i < lines.length && hits.length < MAX_MATCHES; i++) if (lines[i].toLowerCase().includes(q)) hits.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`); };
    if (fs.statSync(root).isFile()) one(root); else this.walkFiles(root, f => { one(f); return hits.length < MAX_MATCHES; });
    return hits.length ? hits.join('\n') + (hits.length >= MAX_MATCHES ? '\n(... more not shown)' : '') : 'No matches.';
  }
  t_get_file_info({ path: p }) { const f = this.resolve(p), st = fs.statSync(f); return [`path: ${f}`, `type: ${st.isDirectory() ? 'folder' : 'file'}`, `size: ${human(st.size)} (${st.size} bytes)`, `modified: ${st.mtime.toISOString()}`, `created: ${st.birthtime.toISOString()}`].join('\n'); }

  keepBackup(real) {
    if (!this.backupDir || !fs.existsSync(real) || !fs.statSync(real).isFile()) return '';
    fs.mkdirSync(this.backupDir, { recursive: true }); const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${this.P.basename(real)}`; fs.copyFileSync(real, this.P.join(this.backupDir, name));
    const all = fs.readdirSync(this.backupDir).sort(); for (const old of all.slice(0, Math.max(0, all.length - 200))) { try { fs.unlinkSync(this.P.join(this.backupDir, old)); } catch { /* leave it */ } }
    return name;
  }
  t_write_file({ path: p, content }) {
    const text = String(content == null ? '' : content); if (Buffer.byteLength(text) > MAX_WRITE) throw new FsError('That is over the 2 MB limit for one write.');
    const f = this.resolve(p, { mustExist: false, forWrite: true }); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) throw new FsError('That is a folder.');
    const kept = this.keepBackup(f), existed = fs.existsSync(f); fs.writeFileSync(f, text, 'utf8');
    return `${existed ? 'Replaced' : 'Created'} ${f} (${human(Buffer.byteLength(text))}).${kept ? ` The old version is kept as ${kept}.` : ''}`;
  }
  t_edit_file({ path: p, edits, dryRun }) {
    if (!Array.isArray(edits) || !edits.length) throw new FsError('Give at least one edit.');
    const f = this.resolve(p, { forWrite: true }), st = this.readText(f); if (st.size > MAX_READ) throw new FsError('That file is over 1 MB.');
    const raw = fs.readFileSync(f); if (isBinary(raw)) throw new FsError('That looks like a binary file.'); let text = raw.toString('utf8'); const crlf = text.includes('\r\n'); if (crlf) text = text.replace(/\r\n/g, '\n'); const notes = [];
    for (const [i, e] of edits.entries()) { const oldT = String(e.oldText == null ? '' : e.oldText).replace(/\r\n/g, '\n'), newT = String(e.newText == null ? '' : e.newText).replace(/\r\n/g, '\n'); if (!oldT) throw new FsError(`Edit ${i + 1}: oldText is empty.`); const n = text.split(oldT).length - 1; if (n === 0) throw new FsError(`Edit ${i + 1}: that text was not found. Nothing was changed.`); if (n > 1) throw new FsError(`Edit ${i + 1}: that text appears ${n} times; give more of the surrounding text so it appears once. Nothing was changed.`); text = text.replace(oldT, () => newT); notes.push(`- edit ${i + 1}: replaced ${oldT.length} characters with ${newT.length}`); }
    if (dryRun) return `Dry run, nothing saved:\n${notes.join('\n')}`; const kept = this.keepBackup(f); fs.writeFileSync(f, crlf ? text.replace(/\n/g, '\r\n') : text, 'utf8');
    return `Edited ${f}:\n${notes.join('\n')}${kept ? `\nThe old version is kept as ${kept}.` : ''}`;
  }
  t_create_directory({ path: p }) { const f = this.resolve(p, { mustExist: false, forWrite: true, deep: true }); if (fs.existsSync(f)) return `Already exists: ${f}`; fs.mkdirSync(f, { recursive: true }); return `Created ${f}`; }
  t_move_file({ source, destination }) {
    const s = this.resolve(source, { forWrite: true }), d = this.resolve(destination, { mustExist: false, forWrite: true }); if (fs.existsSync(d)) throw new FsError('The destination already exists. Orbit never overwrites: choose another name.');
    if (this.roots.some(r => norm(s, this.P) === norm(r, this.P))) throw new FsError('An allowed folder itself cannot be moved.'); fs.renameSync(s, d); return `Moved ${s} to ${d}`;
  }
  async t_trash_file({ path: p }) { const f = this.resolve(p, { forWrite: true }); if (this.roots.some(r => norm(f, this.P) === norm(r, this.P))) throw new FsError('An allowed folder itself cannot be removed.'); await this.trash(f); return `Moved ${f} to the Recycle Bin.`; }
}

module.exports = { FilesProvider, checkRoots, dangerousRoot, isInside, SECRET_NAME, SECRET_DIR, MAX_READ };
