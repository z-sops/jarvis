'use strict';
// A read-only health report of this computer: free disk space, the size of the usual temporary and cache folders, how much space
// Orbit's own data takes, and how many apps start with Windows. It only reads. It never deletes, moves or changes anything,
// and it never opens a file: it only asks the system for names and sizes. Folder walks are limited in time and number, so the
// answer comes fast; a size marked "partial" is at least that much.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const GB = 1073741824, MB = 1048576;
const human = b => (b >= GB ? (b / GB).toFixed(1) + ' GB' : b >= MB ? Math.round(b / MB) + ' MB' : Math.max(0, Math.round(b / 1024)) + ' KB');

async function dirSize(dir, { maxEntries = 60000, maxMs = 2000 } = {}) {
  const t0 = Date.now(); let bytes = 0, files = 0, entries = 0, partial = false; const stack = [dir];
  while (stack.length) {
    if (Date.now() - t0 > maxMs || entries > maxEntries) { partial = true; break; }
    const d = stack.pop(); let list;
    try { list = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      entries++; const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { stack.push(p); continue; }
      try { const s = await fs.promises.lstat(p); bytes += s.size; files++; } catch { /* vanished or locked: skip */ }
    }
  }
  return { bytes, files, partial };
}

// The places we look at. "clean" only describes what is normally true; this report never cleans anything.
function places({ env, tmp, home }) {
  const L = env.LOCALAPPDATA, U = env.USERPROFILE || home;
  const list = [{ id: 'temp', label: 'Temporary files', dir: tmp, clean: 'usually safe to clear' }];
  if (L) list.push(
    { id: 'inetcache', label: 'Windows internet cache', dir: path.join(L, 'Microsoft', 'Windows', 'INetCache'), clean: 'usually safe to clear' },
    { id: 'crashdumps', label: 'Crash dumps', dir: path.join(L, 'CrashDumps'), clean: 'usually safe to clear' },
    { id: 'npm', label: 'npm cache', dir: path.join(L, 'npm-cache'), clean: 'safe, it downloads again when needed' },
    { id: 'pip', label: 'pip cache', dir: path.join(L, 'pip', 'Cache'), clean: 'safe, it downloads again when needed' });
  if (U) list.push({ id: 'downloads', label: 'Your Downloads folder', dir: path.join(U, 'Downloads'), clean: 'yours: only you decide' });
  return list;
}

// `reg query ...\Run` prints "    Name    REG_SZ    command". Only the names are kept, never the commands.
function parseRunKey(text) { const names = []; for (const line of String(text || '').split(/\r?\n/)) { const m = /^\s{2,}(.+?)\s{2,}REG_\w+\s/.exec(line); if (m) names.push(m[1]); } return names; }
const defaultRun = (cmd, args, ms = 4000) => new Promise(res => execFile(cmd, args, { timeout: ms, windowsHide: true }, (e, out) => res(e ? null : String(out))));

function disks({ platform, statfs }) {
  const roots = platform === 'win32' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => l + ':\\') : ['/'], out = [];
  for (const r of roots) { try { const s = statfs(r), total = s.blocks * s.bsize, free = s.bavail * s.bsize; if (total > 0) out.push({ path: r, freeGB: +(free / GB).toFixed(1), totalGB: +(total / GB).toFixed(1), usedPct: Math.round(((total - free) / total) * 100) }); } catch { /* no such drive */ } }
  return out;
}

async function report({ homeRoot = '', env = process.env, platform = process.platform, tmp = os.tmpdir(), home = os.homedir(), run = defaultRun, statfs = fs.statfsSync, limits = {}, deep = false, look = '', deadlineMs = look ? 90000 : deep ? 60000 : 15000 } = {}) {
  const t0 = Date.now(), over = () => Date.now() - t0 > deadlineMs, summary = [], notes = [];
  const dk = disks({ platform, statfs });
  for (const d of dk) summary.push(`Disk ${d.path.replace(/[\\/]$/, '') || '/'}: ${d.freeGB} GB free of ${d.totalGB} GB (${d.usedPct}% used)`);
  // Look inside one folder of the user profile (for example AppData/Local): its biggest sub-folders. Nothing outside the profile is measured.
  if (look) {
    const U = env.USERPROFILE || home, target = path.resolve(U, String(look)), rel = path.relative(U, target);
    const memory = { freeGB: +(os.freemem() / GB).toFixed(1), totalGB: +(os.totalmem() / GB).toFixed(1), uptimeHours: +(os.uptime() / 3600).toFixed(1) };
    let inside = null;
    if (rel.startsWith('..') || path.isAbsolute(rel) || /^[a-zA-Z]:|^[\\/]/.test(String(look).trim())) notes.push('I only look inside your user profile, so that folder was not measured.');
    else {
      let ok = false; try { ok = fs.statSync(target).isDirectory(); } catch { /* not there */ }
      if (!ok) notes.push(`${rel || 'That folder'} was not found.`);
      else {
        const items = []; let loose = 0, partial = false;
        try {
          for (const e of await fs.promises.readdir(target, { withFileTypes: true })) {
            if (over()) { partial = true; break; } const p = path.join(target, e.name);
            if (e.isSymbolicLink() || /^OneDrive/i.test(e.name)) continue;
            if (e.isDirectory()) { const s = await dirSize(p, { maxEntries: 800000, maxMs: 8000, ...limits }); partial = partial || s.partial; items.push({ label: e.name, path: p, bytes: s.bytes, partial: s.partial }); }
            else { try { loose += (await fs.promises.lstat(p)).size; } catch { /* skip */ } }
          }
        } catch { notes.push('That folder could not be read.'); }
        items.sort((a, b) => b.bytes - a.bytes); inside = { path: target, items: items.slice(0, 12), looseFilesBytes: loose, partial };
        if (items.length) summary.push(`Inside ${rel || 'your profile'}: ` + items.slice(0, 8).map(i => `${i.label} ${i.partial ? 'at least ' : ''}${human(i.bytes)}`).join(', ') + (loose > MB ? `; loose files ${human(loose)}` : ''));
        if (partial) notes.push('The scan stopped early to stay quick; the sizes shown are at least that much.');
      }
    }
    if (!notes.length) notes.push('Nothing stands out.');
    return { at: new Date().toISOString(), changedNothing: true, disks: dk, places: [], orbit: null, profile: null, inside, startup: null, memory, notes, summary };
  }
  const found = [];
  for (const p of places({ env, tmp, home })) {
    if (over()) { notes.push('The report stopped early to stay quick; some folders were not measured.'); break; }
    let ok = false; try { ok = fs.statSync(p.dir).isDirectory(); } catch { /* not there */ }
    if (!ok) continue;
    const s = await dirSize(p.dir, limits); found.push({ id: p.id, label: p.label, path: p.dir, bytes: s.bytes, files: s.files, partial: s.partial, clean: p.clean });
    summary.push(`${p.label}: ${s.partial ? 'at least ' : ''}${human(s.bytes)} in ${s.files}${s.partial ? '+' : ''} files (${p.clean})`);
  }
  let orbit = null;
  if (homeRoot && !over()) {
    try {
      const top = []; let total = 0, partial = false;
      for (const e of await fs.promises.readdir(homeRoot, { withFileTypes: true })) {
        if (over()) { partial = true; break; }
        const p = path.join(homeRoot, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) { const s = await dirSize(p, limits); total += s.bytes; partial = partial || s.partial; top.push({ name: e.name, bytes: s.bytes }); }
        else { try { const s = await fs.promises.lstat(p); total += s.size; } catch { /* skip */ } }
      }
      top.sort((a, b) => b.bytes - a.bytes); orbit = { path: homeRoot, bytes: total, partial, top: top.slice(0, 8) };
      summary.push(`Orbit's own data: ${partial ? 'at least ' : ''}${human(total)}` + (top.length ? `; biggest: ${top.slice(0, 3).map(t => `${t.name} ${human(t.bytes)}`).join(', ')}` : ''));
    } catch { /* home folder not readable */ }
  }
  // Deep mode (only when asked): which folders in the user profile are the biggest. OneDrive is skipped: its files may not be on this disk.
  let profile = null;
  if (deep && !over()) {
    const U = env.USERPROFILE || home, items = [];
    const add = async (label, dir) => {
      if (over()) return; let ok = false; try { ok = fs.statSync(dir).isDirectory(); } catch { /* not there */ }
      if (!ok) return; const s = await dirSize(dir, { maxEntries: 400000, maxMs: 6000, ...limits }); items.push({ label, path: dir, bytes: s.bytes, partial: s.partial });
    };
    try { for (const e of await fs.promises.readdir(U, { withFileTypes: true })) { if (!e.isDirectory() || e.isSymbolicLink() || /^(OneDrive|AppData)/i.test(e.name)) continue; await add(e.name, path.join(U, e.name)); } } catch { /* profile not readable */ }
    await add(path.join('AppData', 'Local'), path.join(U, 'AppData', 'Local')); await add(path.join('AppData', 'Roaming'), path.join(U, 'AppData', 'Roaming'));
    items.sort((a, b) => b.bytes - a.bytes); profile = items.slice(0, 10);
    if (profile.length) summary.push('Biggest folders in your user profile: ' + profile.slice(0, 6).map(p => `${p.label} ${p.partial ? 'at least ' : ''}${human(p.bytes)}`).join(', '));
    if (over()) notes.push('The deep scan stopped early to stay quick; the sizes shown are at least that much.');
  }
  let startup = null;
  if (platform === 'win32' && !over()) {
    const names = [];
    for (const key of ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run']) for (const n of parseRunKey(await run('reg', ['query', key]))) if (!names.includes(n)) names.push(n);
    startup = { count: names.length, names: names.slice(0, 30) }; summary.push(`Apps that start with Windows (the Run lists): ${names.length}`);
  }
  const memory = { freeGB: +(os.freemem() / GB).toFixed(1), totalGB: +(os.totalmem() / GB).toFixed(1), uptimeHours: +(os.uptime() / 3600).toFixed(1) };
  summary.push(`Memory: ${memory.freeGB} GB free of ${memory.totalGB} GB; the computer has been on for ${memory.uptimeHours} hours`);

  for (const d of dk) if (d.freeGB < 15 || d.usedPct >= 90) notes.push(`Drive ${d.path.replace(/[\\/]$/, '')} is nearly full (${d.freeGB} GB free).`);
  const tmpF = found.find(f => f.id === 'temp'); if (tmpF && tmpF.bytes > 2 * GB) notes.push(`Temporary files take ${human(tmpF.bytes)}; that is normally safe to clear.`);
  if (startup && startup.count > 12) notes.push(`${startup.count} apps start with Windows, which can slow the start.`);
  if (memory.uptimeHours > 24 * 14) notes.push('The computer has not been restarted for over two weeks.');
  if (!notes.length) notes.push('Nothing stands out.');
  return { at: new Date().toISOString(), changedNothing: true, disks: dk, places: found, orbit, profile, startup, memory, notes, summary };
}

module.exports = { report, dirSize, places, parseRunKey, human };
