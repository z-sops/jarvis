'use strict';
/*
  Job undo: for every job of a built-in crew member, a small record in <home>\undo\<job>\:
    - the calls it made (name and time), so there is a ledger of what happened,
    - for each file it wrote: a copy of the file as it was before (or "did not exist"), and a fingerprint of what the job left.
  Undo puts the old versions back and removes the files the job created. A file that changed AFTER the job (by you or by anything else) is left alone and reported.
  Besides write_file, the agent's own workspace folder is copied when the job starts and compared when it ends: that covers shell commands and the Hermes / OpenCode engines too,
  for changes INSIDE that folder (new, changed and deleted files). Changes anywhere else by a shell or an outside engine cannot be undone, and the record says so.
  Everything here is best-effort: a problem here never stops a job.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_SNAP = 5 * 1024 * 1024;   // a bigger file is not copied; undo says it cannot restore it
const WS_FILE = 2 * 1024 * 1024, WS_TOTAL = 50 * 1024 * 1024, WS_COUNT = 400;   // the workspace copy: per file, in all, and how many files
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.cache']);
const KEEP_JOBS = 30;               // the records of older jobs are removed (this is Orbit's own cache, not your files)
const cur = new Map();              // agentId -> jobId of the job running now

const dirOf = (home, jobId) => home.p('undo', String(jobId));
const mfOf = (home, jobId) => path.join(dirOf(home, jobId), 'manifest.json');
const fp = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
function read(home, jobId) { try { return JSON.parse(fs.readFileSync(mfOf(home, jobId), 'utf8')); } catch { return null; } }
function save(home, jobId, m) { fs.mkdirSync(dirOf(home, jobId), { recursive: true }); fs.writeFileSync(mfOf(home, jobId), JSON.stringify(m)); }
const jobFor = (agentId) => cur.get(agentId) || (cur.size === 1 ? [...cur.values()][0] : null);

function prune(home) {
  try {
    const root = home.p('undo'), live = new Set(cur.values());
    const dirs = fs.readdirSync(root).map(n => ({ n, t: fs.statSync(path.join(root, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const d of dirs.slice(KEEP_JOBS)) if (!live.has(d.n)) fs.rmSync(path.join(root, d.n), { recursive: true, force: true });
  } catch { /* nothing to prune */ }
}

function begin(home, agentId, jobId, task) {
  try {
    cur.set(agentId, jobId);
    save(home, jobId, { jobId, agentId, task: String(task || '').slice(0, 200), startedAt: new Date().toISOString(), calls: [], files: [], uncovered: false, undone: false });
    prune(home);
  } catch { /* best effort */ }
}
function end(agentId) { cur.delete(agentId); }

// One line in the ledger for every tool the job calls.
function note(home, agentId, tool) {
  try {
    const jobId = jobFor(agentId); if (!jobId) return;
    const m = read(home, jobId); if (!m) return;
    if (m.calls.length < 500) m.calls.push({ t: new Date().toISOString(), tool: String(tool) });
    if (tool === 'run_shell' || tool === 'external_engine') m.uncovered = true;
    save(home, jobId, m);
  } catch { /* best effort */ }
}

// Called just before write_file writes. Keeps the first version only: that is the one undo goes back to.
function before(home, agentId, file) {
  try {
    const jobId = jobFor(agentId); if (!jobId) return;
    const m = read(home, jobId); if (!m || m.files.some(f => f.path === file)) return;
    const e = { path: file, existed: isFile(file), snap: null, big: false, after: null };
    if (e.existed) {
      if (fs.statSync(file).size > MAX_SNAP) e.big = true;
      else { const name = 'f' + m.files.length; fs.mkdirSync(path.join(dirOf(home, jobId), 'files'), { recursive: true }); fs.copyFileSync(file, path.join(dirOf(home, jobId), 'files', name)); e.snap = 'files/' + name; }
    }
    m.files.push(e); save(home, jobId, m);
  } catch { /* best effort */ }
}
// Called right after write_file wrote: the fingerprint of what the job left.
function after(home, agentId, file) {
  try {
    const jobId = jobFor(agentId); if (!jobId) return;
    const m = read(home, jobId); if (!m) return;
    const e = m.files.find(f => f.path === file); if (!e || !isFile(file)) return;
    e.after = fp(file); save(home, jobId, m);
  } catch { /* best effort */ }
}


// ---- the agent's workspace folder: copied at the start, compared at the end (covers shell commands and outside engines) ----
function walk(dir, out = [], depth = 0) {
  if (depth > 6 || out.length > WS_COUNT) return out;
  let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list) {
    const f = path.join(dir, d.name);
    if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name)) walk(f, out, depth + 1); }
    else if (d.isFile()) out.push(f);
    if (out.length > WS_COUNT) break;
  }
  return out;
}
function snapDir(home, agentId, dir) {
  try {
    const jobId = jobFor(agentId); if (!jobId) return;
    const m = read(home, jobId); if (!m) return;
    const files = {}; let total = 0, n = 0; const all = walk(dir);
    m.ws = { dir, files, partial: all.length > WS_COUNT };
    fs.mkdirSync(path.join(dirOf(home, jobId), 'ws'), { recursive: true });
    for (const f of all.slice(0, WS_COUNT)) {
      const st = fs.statSync(f), rec = { size: st.size, mtimeMs: st.mtimeMs, snap: null };
      if (st.size <= WS_FILE && total + st.size <= WS_TOTAL) { const name = 'ws/w' + (n++); fs.copyFileSync(f, path.join(dirOf(home, jobId), name)); rec.snap = name; rec.hash = fp(f); total += st.size; }
      else m.ws.partial = true;
      files[f] = rec;
    }
    save(home, jobId, m);
  } catch { /* best effort */ }
}
function diffDir(home, agentId) {
  try {
    const jobId = jobFor(agentId); if (!jobId) return;
    const m = read(home, jobId); if (!m || !m.ws) return;
    const seen = new Set(m.files.map(f => f.path)), now = new Set(walk(m.ws.dir));
    for (const f of now) {
      if (seen.has(f)) continue;
      const old = m.ws.files[f];
      if (!old) { m.files.push({ path: f, existed: false, snap: null, big: false, after: fp(f) }); continue; }
      const st = fs.statSync(f); if (!old.hash && st.size === old.size && Math.round(st.mtimeMs) === Math.round(old.mtimeMs)) continue;
      const h = fp(f); if (old.hash && h === old.hash) continue;
      m.files.push({ path: f, existed: true, snap: old.snap, big: !old.snap, after: h });
    }
    for (const f of Object.keys(m.ws.files)) if (!now.has(f) && !seen.has(f) && !isFile(f)) m.files.push({ path: f, existed: true, snap: m.ws.files[f].snap, big: !m.ws.files[f].snap, after: null, deleted: true });
    delete m.ws.files;   // the copies stay; the list is not needed any more
    save(home, jobId, m);
  } catch { /* best effort */ }
}

// What undo would do, file by file (changes nothing).
function plan(home, jobId) {
  const m = read(home, jobId); if (!m) return null;
  const items = m.files.map(e => {
    const now = isFile(e.path);
    if (e.deleted) return now ? { path: e.path, action: 'skip', why: 'a file with that name exists again, left alone' } : (e.snap ? { path: e.path, action: 'restore', why: 'deleted by the job, comes back' } : { path: e.path, action: 'skip', why: 'deleted by the job but too big to have been copied, cannot restore' });
    if (!e.after) return { path: e.path, action: 'nothing', why: 'the job wrote nothing to it' };
    if (now && fp(e.path) !== e.after) return { path: e.path, action: 'skip', why: 'changed after the job, left alone' };
    if (e.existed && (e.big || !e.snap)) return { path: e.path, action: 'skip', why: 'too big to have been copied, cannot restore' };
    if (e.existed) return { path: e.path, action: 'restore', why: 'goes back to the version from before the job' };
    return now ? { path: e.path, action: 'remove', why: 'created by the job' } : { path: e.path, action: 'nothing', why: 'already gone' };
  });
  return { m, items };
}

function undo(home, jobId) {
  const p = plan(home, jobId); if (!p) return { ok: false, error: 'There is no record for that job.' };
  if (p.m.undone) return { ok: false, error: 'That job was already undone.' };
  const out = { ok: true, restored: [], removed: [], skipped: [], uncovered: !!p.m.uncovered };
  for (const it of p.items.slice().reverse()) {
    try {
      if (it.action === 'restore') { const e = p.m.files.find(f => f.path === it.path); fs.mkdirSync(path.dirname(it.path), { recursive: true }); fs.copyFileSync(path.join(dirOf(home, jobId), e.snap.includes('/') ? e.snap : 'files/' + e.snap), it.path); out.restored.push(it.path); }
      else if (it.action === 'remove') { fs.unlinkSync(it.path); out.removed.push(it.path); }
      else if (it.action === 'skip') out.skipped.push({ path: it.path, why: it.why });
    } catch (e) { out.skipped.push({ path: it.path, why: String((e && e.message) || e) }); }
  }
  p.m.undone = true; try { save(home, jobId, p.m); } catch { /* the files are already back */ }
  return out;
}

function recent(home, n = 8) {
  try {
    const root = home.p('undo');
    return fs.readdirSync(root).map(d => read(home, d)).filter(Boolean).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, n)
      .map(m => ({ job: m.jobId, agent: m.agentId, task: m.task, when: m.startedAt, files: m.files.filter(f => f.after || f.deleted).length, calls: m.calls.length, usedShellOrExternalEngine: !!m.uncovered, undone: !!m.undone }));
  } catch { return []; }
}

// The Laila tool. No job: the list. A job without confirm: a preview. With confirm: it is done.
function tool(home, a) {
  const id = String(a.job_id || '').trim();
  if (!id) { const list = recent(home); return list.length ? { jobs: list } : { jobs: [], note: 'No job has a record yet. Records start with the jobs the crew does from now on.' }; }
  if (!a.confirm) {
    const p = plan(home, id); if (!p) return { error: 'There is no record for that job.' };
    return { job: id, task: p.m.task, undone: !!p.m.undone, wouldDo: p.items, calls: p.m.calls.length, notCovered: p.m.uncovered ? 'This job also ran shell commands or used an outside engine: changes inside the agent\'s own workspace folder are covered above, but anything those changed anywhere else cannot be undone here.' : undefined, next: 'Nothing was changed. If the user agrees, call again with confirm true.' };
  }
  return undo(home, id);
}

module.exports = { begin, end, note, before, after, snapDir, diffDir, plan, undo, recent, tool, _cur: cur };
