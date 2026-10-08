'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('../lib/health');
const LT = require('../lib/laila-tools');

const tree = o => { const out = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) { out.push('d ' + p); walk(p); } else out.push('f ' + p + ' ' + fs.statSync(p).size); } }; walk(o); return out.join('\n'); };
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-')), w = (rel, n) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(n, 1)); };
  w('local/Temp/a.tmp', 5000); w('local/Temp/sub/b.tmp', 3000); w('local/CrashDumps/c.dmp', 2000); w('user/Downloads/big.iso', 10000);
  w('user/Documents/d.bin', 7000); w('user/AppData/Local/big/x.bin', 9000); w('user/OneDrive/skip.bin', 99999); w('orbit/workspace/x.txt', 4000); w('orbit/logs/l.log', 1000); w('orbit/readme.md', 100);
  return root;
}

test('dirSize adds up every file in every sub-folder, and says when it stopped early', async () => {
  const root = fixture(); const s = await H.dirSize(path.join(root, 'local', 'Temp')); assert.equal(s.bytes, 8000); assert.equal(s.files, 2); assert.equal(s.partial, false);
  const stopped = await H.dirSize(path.join(root, 'local'), { maxEntries: 1 }); assert.equal(stopped.partial, true, 'a limit makes the size "at least"');
  assert.deepEqual(await H.dirSize(path.join(root, 'nope')), { bytes: 0, files: 0, partial: false }, 'a missing folder is just empty');
});

test('the report measures the usual places, the home folder, and the startup list; missing places are skipped', async () => {
  const root = fixture(), env = { LOCALAPPDATA: path.join(root, 'local'), USERPROFILE: path.join(root, 'user') };
  const run = async (cmd, args) => (args[1].startsWith('HKCU') ? '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    OneDrive    REG_SZ    "C:\\Users\\x\\OneDrive.exe" /background\r\n    Orbit    REG_SZ    C:\\Orbit.exe\r\n' : null);
  const statfs = r => (r === 'C:\\' ? { blocks: 1000, bsize: 1073741824, bavail: 100 } : (() => { throw new Error('no drive'); })());
  const r = await H.report({ homeRoot: path.join(root, 'orbit'), env, platform: 'win32', tmp: path.join(root, 'local', 'Temp'), home: path.join(root, 'user'), run, statfs });
  assert.equal(r.changedNothing, true); assert.deepEqual(r.disks, [{ path: 'C:\\', freeGB: 100, totalGB: 1000, usedPct: 90 }]);
  const by = Object.fromEntries(r.places.map(p => [p.id, p])); assert.equal(by.temp.bytes, 8000); assert.equal(by.crashdumps.bytes, 2000); assert.equal(by.downloads.bytes, 10000); assert.equal(by.npm, undefined, 'a folder that is not there is not listed');
  assert.equal(r.orbit.bytes, 5100); assert.equal(r.orbit.top[0].name, 'workspace'); assert.deepEqual(r.startup, { count: 2, names: ['OneDrive', 'Orbit'] }, 'names only, never the command');
  assert.ok(r.notes.some(n => /nearly full/.test(n)), 'a drive at 90% is called out'); assert.ok(r.summary.length >= 6);
  assert.ok(!JSON.stringify(r).includes('OneDrive.exe'), 'no command lines in the answer');
});

test('it only reads: the folders look exactly the same afterwards', async () => {
  const root = fixture(), before = tree(root), env = { LOCALAPPDATA: path.join(root, 'local'), USERPROFILE: path.join(root, 'user') };
  await H.report({ homeRoot: path.join(root, 'orbit'), env, platform: 'linux', tmp: path.join(root, 'local', 'Temp'), home: path.join(root, 'user'), run: async () => null, statfs: () => ({ blocks: 10, bsize: 1073741824, bavail: 9 }) });
  assert.equal(tree(root), before);
});

test('parseRunKey keeps names and drops commands; human sizes read well', () => {
  assert.deepEqual(H.parseRunKey('HKEY\\x\r\n    A App    REG_SZ    "C:\\a.exe" --secret=1\r\n    B    REG_EXPAND_SZ    %x%\r\n'), ['A App', 'B']); assert.deepEqual(H.parseRunKey(null), []);
  assert.equal(H.human(500), '0 KB'); assert.equal(H.human(5 * 1048576), '5 MB'); assert.equal(H.human(3 * 1073741824), '3.0 GB');
});

test('Laila has a system_health tool, and it needs no arguments', () => {
  const d = LT.decls().system_health; assert.ok(d, 'declared'); assert.equal(d.parameters.type, 'OBJECT'); assert.deepEqual(Object.keys(d.parameters.properties), ['deep', 'look_in']); assert.match(d.description, /Changes nothing/);
  const t = LT.impl({ runtime: {}, home: { root: os.tmpdir(), agentDir: () => os.tmpdir() }, getCfg: () => ({}), bus: { emit() {} } }); assert.equal(typeof t.system_health, 'function');
});

test('deep mode lists the biggest folders of the user profile (OneDrive skipped), and the normal mode does not', async () => {
  const root = fixture(), env = { LOCALAPPDATA: path.join(root, 'user', 'AppData', 'Local'), USERPROFILE: path.join(root, 'user') }, before = tree(root);
  const base = { homeRoot: path.join(root, 'orbit'), env, platform: 'linux', tmp: path.join(root, 'local', 'Temp'), home: path.join(root, 'user'), run: async () => null, statfs: () => ({ blocks: 10, bsize: 1073741824, bavail: 9 }) };
  const quick = await H.report(base); assert.equal(quick.profile, null);
  const d = await H.report({ ...base, deep: true }); assert.deepEqual(d.profile.map(p => p.label), ['Downloads', path.join('AppData', 'Local'), 'Documents'], 'biggest first; OneDrive and an empty AppData parent are left out');
  assert.equal(d.profile[0].bytes, 10000); assert.ok(d.summary.some(l => /Biggest folders in your user profile: Downloads/.test(l))); assert.equal(tree(root), before, 'still read only');
});

test('look_in: the biggest sub-folders of one profile folder, and nothing outside the profile is ever measured', async () => {
  const root = fixture(); fs.mkdirSync(path.join(root, 'user', 'AppData', 'Local', 'small'), { recursive: true }); fs.writeFileSync(path.join(root, 'user', 'AppData', 'Local', 'small', 's.bin'), Buffer.alloc(100)); fs.writeFileSync(path.join(root, 'user', 'AppData', 'Local', 'loose.txt'), Buffer.alloc(50));
  const base = { homeRoot: path.join(root, 'orbit'), env: { USERPROFILE: path.join(root, 'user') }, platform: 'linux', tmp: path.join(root, 'local', 'Temp'), home: path.join(root, 'user'), run: async () => null, statfs: () => ({ blocks: 10, bsize: 1073741824, bavail: 9 }) }, before = tree(root);
  const r = await H.report({ ...base, look: 'AppData/Local' }); assert.deepEqual(r.inside.items.map(i => i.label), ['big', 'small']); assert.equal(r.inside.items[0].bytes, 9000); assert.equal(r.inside.looseFilesBytes, 50); assert.ok(r.summary.some(l => /Inside AppData.Local: big/.test(l)));
  for (const bad of ['..', '../orbit', path.join(root, 'orbit'), '/', 'C:\\Windows']) { const x = await H.report({ ...base, look: bad }); assert.equal(x.inside, null, bad + ' is refused'); assert.ok(x.notes.some(n => /only look inside your user profile/.test(n)), bad); }
  assert.ok((await H.report({ ...base, look: 'Nope/Missing' })).notes.some(n => /was not found/.test(n)));
  assert.equal(tree(root), before, 'still read only');
});
